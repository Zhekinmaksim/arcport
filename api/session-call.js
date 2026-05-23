import { signDeveloperTypedData } from './_circle.js';
import {
  callMarketplaceApi,
  isBuiltinApi,
  resolveMarketplaceApi,
} from './_marketplace.js';
import {
  acquireIdempotencyRequest,
  completeIdempotencyRequest,
  failIdempotencyRequest,
  getIdempotencyKey,
} from './_request-dedupe.js';
import { resolveWalletByToken } from './_wallet-identity.js';
import {
  buildSessionVoucherTypedData,
  getOnchainChannel,
  verifySessionVoucher,
  SESSION_PRICE_ATOMIC,
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

    const { channel_id, api_id, params = {} } = req.body || {};
    if (!channel_id) return res.status(400).json({ error: 'channel_id is required' });
    if (!api_id) return res.status(400).json({ error: 'api_id is required' });

    const dedupe = await acquireIdempotencyRequest({
      requestKey,
      requestScope: 'session-call',
      walletId: wallet.wallet_id,
      channelId: channel_id,
      requestBody: req.body || {},
    });
    if (dedupe.kind === 'replay' || dedupe.kind === 'pending' || dedupe.kind === 'channel-busy') {
      return res.status(dedupe.status).json(dedupe.body);
    }

    let apiRow = null;
    if (!isBuiltinApi(api_id)) {
      apiRow = await resolveMarketplaceApi(api_id, sbGet);
      if (!apiRow) return res.status(404).json({ error: `API not found: ${api_id}` });
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
    const sessionMetadata = session.metadata && typeof session.metadata === 'object' ? session.metadata : {};
    const allowedApiIds = Array.isArray(sessionMetadata.allowed_api_ids) ? sessionMetadata.allowed_api_ids : [];
    if (allowedApiIds.length && !allowedApiIds.includes(api_id)) {
      return res.status(403).json({
        error: 'API is not allowed by this session policy',
        channel_id,
        api_id,
        allowed_api_ids: allowedApiIds,
      });
    }
    const maxCalls = Number(sessionMetadata.max_calls || 0);
    if (maxCalls > 0 && Number(session.calls_total || 0) >= maxCalls) {
      return res.status(402).json({
        error: 'Session call limit reached',
        channel_id,
        calls_total: Number(session.calls_total || 0),
        max_calls: maxCalls,
      });
    }

    const contractAddress = session.contract_address;
    const onchain = await getOnchainChannel(channel_id, contractAddress);
    if (onchain.closed) {
      return res.status(400).json({ error: 'Channel is already closed onchain' });
    }

    const currentAtomic = BigInt(session.cumulative_atomic || '0');
    const nextAtomic = currentAtomic + BigInt(SESSION_PRICE_ATOMIC);
    const depositAtomic = BigInt(session.deposit_atomic || onchain.deposit);
    if (nextAtomic > depositAtomic) {
      return res.status(402).json({
        error: 'Session exhausted',
        channel_id,
        cumulative_atomic: currentAtomic.toString(),
        deposit_atomic: depositAtomic.toString(),
        remaining_calls: onchain.remaining_calls,
      });
    }

    const typedData = buildSessionVoucherTypedData(channel_id, nextAtomic.toString(), contractAddress);
    const signature = await signDeveloperTypedData({
      walletId: wallet.circle_wallet_id,
      walletAddress: wallet.arc_address,
      typedData,
      memo: `ArcPort session ${channel_id} ${api_id}`,
    });

    const signer = await verifySessionVoucher({
      channelId: channel_id,
      cumulative: nextAtomic.toString(),
      signature,
      contractAddress,
    });
    if (signer.toLowerCase() !== wallet.arc_address.toLowerCase()) {
      return res.status(400).json({ error: 'Voucher signature verification failed' });
    }

    const { data, error: apiError, latency_ms } = await callMarketplaceApi({
      apiId: api_id,
      params,
      apiRow,
      sbPatch,
    });
    if (apiError) {
      const payload = {
        error: 'API call failed',
        reason: apiError,
        channel_id,
      };
      await failIdempotencyRequest(requestKey, {
        responseStatus: 502,
        responseBody: payload,
        channelId: channel_id,
      });
      return res.status(502).json(payload);
    }

    const nextSpent = Number(nextAtomic) / 1e6;
    const nextCalls = Number(session.calls_total || 0) + 1;
    const payee = process.env.PLATFORM_ARC_ADDRESS || null;
    const metadata = {
      ...sessionMetadata,
      agent_runtime: req.body?.agent_runtime || sessionMetadata.agent_runtime || null,
      task: req.body?.task || sessionMetadata.task || null,
      last_api_id: api_id,
      last_signature: signature,
      last_response_at: new Date().toISOString(),
      last_voucher_cumulative_atomic: nextAtomic.toString(),
    };

    const accountingResponse = await sbPatch('session_channels', `channel_id=eq.${encodeURIComponent(channel_id)}`, {
      cumulative_spent: nextSpent,
      cumulative_atomic: nextAtomic.toString(),
      calls_total: nextCalls,
      metadata,
    });
    const accountingRows = accountingResponse.ok ? await accountingResponse.json().catch(() => []) : [];
    const accountingRow = Array.isArray(accountingRows) ? accountingRows[0] : null;
    if (!accountingResponse.ok || !accountingRow || String(accountingRow.cumulative_atomic || '') !== nextAtomic.toString()) {
      const detail = accountingResponse.ok
        ? 'Supabase did not return the updated session accounting row'
        : await accountingResponse.text().catch(() => 'Supabase accounting write failed');
      const payload = {
        error: 'Session accounting failed after API execution. Paid response was not returned.',
        reason: detail,
        channel_id,
      };
      await failIdempotencyRequest(requestKey, {
        responseStatus: 502,
        responseBody: payload,
        channelId: channel_id,
      });
      return res.status(502).json(payload);
    }

    const payload = {
      success: true,
      mode: 'session',
      channel_id,
      contract_address: contractAddress,
      api: { id: api_id, latency_ms },
      payment: {
        amount: 0.001,
        currency: 'USDC',
        network: 'Arc Testnet',
        payment_type: 'session_voucher',
        settlement_channel: 'arcstream',
        tx_hash: null,
        settlement_id: null,
        note: 'The API call is authorized by an offchain EIP-712 session voucher. Onchain settlement happens when the session channel is closed.',
        payee: payee ? { arc_address: payee } : null,
      },
      voucher: {
        cumulative_atomic: nextAtomic.toString(),
        cumulative_usdc: nextSpent,
        signature,
        signer,
      },
      session: {
        deposit_usdc: Number(session.deposit_amount),
        spent_usdc: nextSpent,
        remaining_usdc: Number((Number(session.deposit_amount) - nextSpent).toFixed(6)),
        calls_total: nextCalls,
        remaining_calls: Math.max(0, Math.floor((Number(session.deposit_amount) - nextSpent) / 0.001)),
        expires_at: session.expires_at,
        agent_runtime: metadata.agent_runtime,
        task: metadata.task,
        allowed_api_ids: metadata.allowed_api_ids || [],
        max_calls: metadata.max_calls || null,
      },
      data,
    };

    await completeIdempotencyRequest(requestKey, {
      responseStatus: 200,
      responseBody: payload,
      channelId: channel_id,
    });

    return res.status(200).json(payload);
  } catch (err) {
    const statusCode = err.statusCode || 500;
    const payload = { error: err.message };
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
    return res.status(statusCode).json(payload);
  }
}
