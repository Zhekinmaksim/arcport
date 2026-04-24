import {
  createContractExecution,
  waitForDeveloperTransaction,
} from './_circle.js';
import {
  acquireIdempotencyRequest,
  completeIdempotencyRequest,
  failIdempotencyRequest,
  getIdempotencyKey,
} from './_request-dedupe.js';
import { resolveWalletByToken } from './_wallet-identity.js';
import {
  getSessionContractAddress,
  getSessionDeposit,
  getUsdcBalanceAtomic,
  SESSION_OPEN_BUFFER_ATOMIC,
  parseOpenedChannel,
  USDC_ADDRESS,
} from './_session-channel.js';

const sbH = () => ({
  'Content-Type': 'application/json',
  'apikey': process.env.SUPABASE_ANON_KEY,
  'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`,
});
const sbGet = (table, filter) =>
  fetch(`${process.env.SUPABASE_URL}/rest/v1/${table}?${filter}&select=*`, { headers: sbH() }).then(r => r.json());
const sbPost = (table, body) =>
  fetch(`${process.env.SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: { ...sbH(), 'Prefer': 'return=representation' },
    body: JSON.stringify(body),
  });

function formatAtomicUsdc(value) {
  const atomic = BigInt(value || 0);
  const whole = atomic / 1000000n;
  const fraction = String(atomic % 1000000n).padStart(6, '0').slice(0, 3);
  return `${whole}.${fraction}`;
}

async function persistChannel(record) {
  const response = await sbPost('session_channels', record).catch(() => null);
  if (response?.ok) {
    const rows = await response.json().catch(() => []);
    return { row: rows[0] || record, schema_warning: null };
  }

  const body = response ? await response.text().catch(() => '') : '';
  if (/session_channels|schema cache|column|relation/i.test(body)) {
    throw new Error('Supabase session schema missing. Run the updated supabase-v2-migration.sql before using session mode.');
  }

  throw new Error(body || 'Failed to persist session channel');
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Idempotency-Key');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const authToken = (req.headers.authorization || '').replace('Bearer ', '').trim();
    if (!authToken) return res.status(401).json({ error: 'Missing wallet identity key' });
    const requestKey = getIdempotencyKey(req);

    const wallet = await resolveWalletByToken(authToken, sbGet);
    if (!wallet) return res.status(401).json({ error: 'Invalid wallet identity key' });
    if (wallet.wallet_type !== 'circle' || !wallet.circle_wallet_id) {
      return res.status(400).json({ error: 'Session mode requires a Circle wallet identity' });
    }

    const dedupe = await acquireIdempotencyRequest({
      requestKey,
      requestScope: 'session-open',
      walletId: wallet.wallet_id,
      requestBody: req.body || {},
    });
    if (dedupe.kind === 'replay' || dedupe.kind === 'pending') {
      return res.status(dedupe.status).json(dedupe.body);
    }

    const contractAddress = getSessionContractAddress();
    const deposit = getSessionDeposit({
      depositUsdc: req.body?.deposit_usdc,
      expectedCalls: req.body?.expected_calls,
    });
    const walletBalanceAtomic = await getUsdcBalanceAtomic(wallet.arc_address);
    const requiredAtomic = BigInt(deposit.deposit_atomic) + BigInt(SESSION_OPEN_BUFFER_ATOMIC);
    if (walletBalanceAtomic < requiredAtomic) {
      return res.status(400).json({
        error: `Operator wallet needs at least ${formatAtomicUsdc(requiredAtomic)} USDC onchain to open this session. Gateway balance is only for charge mode; fund the wallet on Arc Testnet or deposit less into Gateway.`,
        reason: 'operator_wallet_balance_too_low',
        wallet_balance_usdc: formatAtomicUsdc(walletBalanceAtomic),
        required_wallet_balance_usdc: formatAtomicUsdc(requiredAtomic),
        session_budget_usdc: deposit.deposit_usdc,
      });
    }

    const approveTxId = await createContractExecution({
      walletId: wallet.circle_wallet_id,
      walletAddress: wallet.arc_address,
      contractAddress: USDC_ADDRESS,
      abiFunctionSignature: 'approve(address,uint256)',
      abiParameters: [contractAddress, deposit.deposit_atomic],
      refId: `arcport-session-approve-${wallet.wallet_id}-${requestKey}`,
    });
    const approveTx = await waitForDeveloperTransaction(approveTxId);
    if (approveTx.state !== 'COMPLETE') {
      return res.status(500).json({ error: `USDC approve failed: ${approveTx.state}` });
    }

    const openTxId = await createContractExecution({
      walletId: wallet.circle_wallet_id,
      walletAddress: wallet.arc_address,
      contractAddress,
      abiFunctionSignature: 'open(uint256)',
      abiParameters: [deposit.deposit_atomic],
      refId: `arcport-session-open-${wallet.wallet_id}-${requestKey}`,
    });
    const openTx = await waitForDeveloperTransaction(openTxId);
    if (openTx.state !== 'COMPLETE' || !openTx.txHash) {
      return res.status(500).json({ error: `Session open failed: ${openTx.state}` });
    }

    const opened = await parseOpenedChannel({
      txHash: openTx.txHash,
      contractAddress,
    });

    const record = {
      channel_id: opened.channel_id,
      wallet_id: wallet.wallet_id,
      identity_key: wallet.identity_key,
      agent_key: wallet.agent_key,
      agent_arc_address: wallet.arc_address,
      circle_wallet_id: wallet.circle_wallet_id,
      contract_address: contractAddress,
      deposit_amount: deposit.deposit_usdc,
      deposit_atomic: deposit.deposit_atomic,
      cumulative_spent: 0,
      cumulative_atomic: '0',
      calls_total: 0,
      status: 'open',
      approve_tx_hash: approveTx.txHash || null,
      open_tx_hash: openTx.txHash,
      expires_at: new Date(opened.expiry_unix * 1000).toISOString(),
      metadata: {
        mode: 'session',
        expected_calls: deposit.expected_calls,
      },
    };

    await persistChannel(record);

    const payload = {
      success: true,
      mode: 'session',
      channel_id: opened.channel_id,
      contract_address: contractAddress,
      wallet: {
        wallet_id: wallet.wallet_id,
        identity_key: wallet.identity_key,
        arc_address: wallet.arc_address,
        circle_wallet_id: wallet.circle_wallet_id,
      },
      deposit_usdc: deposit.deposit_usdc,
      deposit_atomic: deposit.deposit_atomic,
      expected_calls: deposit.expected_calls,
      approve_tx_hash: approveTx.txHash || null,
      open_tx_hash: openTx.txHash,
      expires_at: new Date(opened.expiry_unix * 1000).toISOString(),
      explorer: {
        contract: `https://testnet.arcscan.app/address/${contractAddress}`,
        approve_tx: approveTx.txHash ? `https://testnet.arcscan.app/tx/${approveTx.txHash}` : null,
        open_tx: `https://testnet.arcscan.app/tx/${openTx.txHash}`,
      },
      next_steps: [
        '1. Sign cumulative vouchers offchain for each API call',
        '2. Use /api/session-call for repeated calls without per-call onchain tx',
        '3. Close with /api/session-close to settle and refund the remainder',
      ],
    };

    await completeIdempotencyRequest(requestKey, {
      responseStatus: 201,
      responseBody: payload,
      channelId: opened.channel_id,
    });

    return res.status(201).json(payload);
  } catch (err) {
    const statusCode = err.statusCode || 500;
    const payload = { error: err.message };
    try {
      const requestKey = (req.headers['x-idempotency-key'] || '').trim();
      if (requestKey) {
        await failIdempotencyRequest(requestKey, {
          responseStatus: statusCode,
          responseBody: payload,
        });
      }
    } catch (_) {
      // keep original error response
    }
    return res.status(statusCode).json(payload);
  }
}
