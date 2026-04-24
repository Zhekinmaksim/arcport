import { Contract, JsonRpcProvider, Wallet } from 'ethers';

import { signDeveloperTypedData } from './_circle.js';
import { ARC_CHAIN_ID, ARC_RPC } from './_arcport-payment.js';
import {
  acquireIdempotencyRequest,
  completeIdempotencyRequest,
  failIdempotencyRequest,
  getIdempotencyKey,
} from './_request-dedupe.js';
import { resolveWalletByToken } from './_wallet-identity.js';
import {
  buildSessionVoucherTypedData,
  parseClosedChannel,
  SESSION_CHANNEL_ABI,
  verifySessionVoucher,
} from './_session-channel.js';

const sbH = () => ({
  'Content-Type': 'application/json',
  'apikey': process.env.SUPABASE_ANON_KEY,
  'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`,
});
const sbGet = (table, filter) =>
  fetch(`${process.env.SUPABASE_URL}/rest/v1/${table}?${filter}&select=*`, { headers: sbH() }).then(r => r.json());
const sbPatch = (table, filter, body) =>
  fetch(`${process.env.SUPABASE_URL}/rest/v1/${table}?${filter}`, {
    method: 'PATCH',
    headers: { ...sbH(), 'Prefer': 'return=representation' },
    body: JSON.stringify(body),
  });

function isTxpoolFullError(error) {
  const message = String(error?.message || '').toLowerCase();
  return message.includes('txpool is full') || message.includes('replacement transaction underpriced');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function sendCloseWithRetry(contract, channelId, cumulativeAtomic, signature, {
  attempts = 7,
  backoffMs = [1500, 3000, 5000, 8000, 12000, 16000],
} = {}) {
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const tx = await contract.close(channelId, cumulativeAtomic, signature);
      return tx;
    } catch (error) {
      lastError = error;
      if (!isTxpoolFullError(error) || attempt === attempts) break;
      const waitMs = backoffMs[Math.min(attempt - 1, backoffMs.length - 1)] || 5000;
      await sleep(waitMs);
    }
  }

  throw lastError;
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
    if (!process.env.ARC_PRIVATE_KEY) {
      return res.status(500).json({ error: 'ARC_PRIVATE_KEY required for session close' });
    }

    const { channel_id } = req.body || {};
    if (!channel_id) return res.status(400).json({ error: 'channel_id is required' });

    const dedupe = await acquireIdempotencyRequest({
      requestKey,
      requestScope: 'session-close',
      walletId: wallet.wallet_id,
      channelId: channel_id,
      requestBody: req.body || {},
    });
    if (dedupe.kind === 'replay' || dedupe.kind === 'pending') {
      return res.status(dedupe.status).json(dedupe.body);
    }

    const sessionRows = await sbGet('session_channels', `channel_id=eq.${encodeURIComponent(channel_id)}`);
    const session = sessionRows[0];
    if (!session) return res.status(404).json({ error: 'Session channel not found' });
    if (session.identity_key && session.identity_key !== wallet.identity_key) {
      return res.status(403).json({ error: 'Channel does not belong to this wallet identity' });
    }
    if (session.status !== 'open') {
      return res.status(400).json({ error: `Channel is not open: ${session.status}` });
    }

    const requestedCumulative = req.body?.cumulative_atomic;
    const sessionMetadata = session.metadata && typeof session.metadata === 'object' ? session.metadata : {};
    const cumulativeAtomic = String(requestedCumulative || session.cumulative_atomic || '0');
    let signature = req.body?.signature || null;

    if (!signature && sessionMetadata.last_signature && String(sessionMetadata.last_voucher_cumulative_atomic || '') === cumulativeAtomic) {
      signature = sessionMetadata.last_signature;
    }

    if (!signature) {
      const typedData = buildSessionVoucherTypedData(channel_id, cumulativeAtomic, session.contract_address);
      signature = await signDeveloperTypedData({
        walletId: wallet.circle_wallet_id,
        walletAddress: wallet.arc_address,
        typedData,
        memo: `ArcPort session close ${channel_id}`,
      });
    }

    const signer = await verifySessionVoucher({
      channelId: channel_id,
      cumulative: cumulativeAtomic,
      signature,
      contractAddress: session.contract_address,
    });
    if (signer.toLowerCase() !== wallet.arc_address.toLowerCase()) {
      return res.status(400).json({ error: 'Final voucher verification failed' });
    }

    const provider = new JsonRpcProvider(
      ARC_RPC,
      { chainId: ARC_CHAIN_ID, name: 'arc-testnet' },
      { staticNetwork: true }
    );
    const platformWallet = new Wallet(process.env.ARC_PRIVATE_KEY, provider);
    const contract = new Contract(session.contract_address, SESSION_CHANNEL_ABI, platformWallet);

    const tx = await sendCloseWithRetry(contract, channel_id, cumulativeAtomic, signature);
    const receipt = await tx.wait();
    const closed = await parseClosedChannel({
      txHash: receipt.hash,
      contractAddress: session.contract_address,
    });

    const paidToPlatform = Number(closed.paid_to_platform_atomic) / 1e6;
    const refundedToAgent = Number(closed.refunded_to_agent_atomic) / 1e6;
    const metadata = {
      ...sessionMetadata,
      final_signature: signature,
      final_voucher_cumulative_atomic: cumulativeAtomic,
      closed_via: 'platform-close',
      paid_to_platform_atomic: closed.paid_to_platform_atomic,
      refunded_to_agent_atomic: closed.refunded_to_agent_atomic,
    };

    await sbPatch('session_channels', `channel_id=eq.${encodeURIComponent(channel_id)}`, {
      status: 'closed',
      close_tx_hash: receipt.hash,
      closed_at: new Date().toISOString(),
      metadata,
    });

    const payload = {
      success: true,
      mode: 'session',
      channel_id,
      close_tx_hash: receipt.hash,
      paid_to_platform_usdc: paidToPlatform,
      refunded_to_agent_usdc: refundedToAgent,
      cumulative_spent_usdc: Number(session.cumulative_spent || 0),
      calls_total: Number(session.calls_total || 0),
      explorer: `https://testnet.arcscan.app/tx/${receipt.hash}`,
    };

    await completeIdempotencyRequest(requestKey, {
      responseStatus: 200,
      responseBody: payload,
      channelId: channel_id,
    });

    return res.status(200).json(payload);
  } catch (err) {
    const statusCode = err.statusCode || (isTxpoolFullError(err) ? 503 : 500);
    const payload = isTxpoolFullError(err)
      ? { error: 'Arc RPC txpool is full. ArcPort retried automatically, but the network is still congested. Try closing the session again in a few seconds.' }
      : { error: err.message };
    try {
      const requestKey = (req.headers['x-idempotency-key'] || '').trim();
      const channelId = req.body?.channel_id || null;
      if (requestKey) {
        await failIdempotencyRequest(requestKey, {
          responseStatus: statusCode,
          responseBody: payload,
          channelId: channelId || null,
        });
      }
    } catch (_) {
      // keep original error response
    }
    if (isTxpoolFullError(err)) {
      return res.status(503).json(payload);
    }
    return res.status(statusCode).json(payload);
  }
}
