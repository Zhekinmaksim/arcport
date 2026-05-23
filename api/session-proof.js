import { resolveWalletByToken } from './_wallet-identity.js';

const sbH = () => ({
  'Content-Type': 'application/json',
  'apikey': process.env.SUPABASE_ANON_KEY,
  'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`,
});

const sbGet = (table, filter) =>
  fetch(`${process.env.SUPABASE_URL}/rest/v1/${table}?${filter}&select=*`, { headers: sbH() }).then(r => r.json());

function sessionProofPayload(session) {
  const metadata = session.metadata && typeof session.metadata === 'object' ? session.metadata : {};
  const refundedFromMetadata = (() => {
    try { return Number(BigInt(metadata.refunded_to_agent_atomic || 0)) / 1e6; }
    catch (_) { return undefined; }
  })();
  const paidFromMetadata = (() => {
    try { return Number(BigInt(metadata.paid_to_platform_atomic || 0)) / 1e6; }
    catch (_) { return undefined; }
  })();
  return {
    success: true,
    mode: 'session',
    channel_id: session.channel_id,
    contract_address: session.contract_address,
    wallet_id: session.wallet_id,
    agent_arc_address: session.agent_arc_address,
    status: session.status,
    deposit_usdc: Number(session.deposit_amount || 0),
    cumulative_usdc: Number(session.cumulative_spent || 0),
    cumulative_atomic: session.cumulative_atomic || '0',
    calls_total: Number(session.calls_total || 0),
    remaining_usdc: Math.max(0, Number(session.deposit_amount || 0) - Number(session.cumulative_spent || 0)),
    refunded_to_agent_usdc: session.refunded_to_agent_usdc ?? refundedFromMetadata,
    paid_to_platform_usdc: session.paid_to_platform_usdc ?? paidFromMetadata,
    open_tx_hash: session.open_tx_hash,
    close_tx_hash: session.close_tx_hash,
    expires_at: session.expires_at,
    agent_runtime: metadata.agent_runtime || null,
    task: metadata.task || null,
    allowed_api_ids: metadata.allowed_api_ids || [],
    max_calls: metadata.max_calls || metadata.expected_calls || null,
    explorer: {
      contract: session.contract_address ? `https://testnet.arcscan.app/address/${session.contract_address}` : null,
      open_tx: session.open_tx_hash ? `https://testnet.arcscan.app/tx/${session.open_tx_hash}` : null,
      close_tx: session.close_tx_hash ? `https://testnet.arcscan.app/tx/${session.close_tx_hash}` : null,
    },
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const authToken = (req.headers.authorization || '').replace('Bearer ', '').trim();
    if (!authToken) return res.status(401).json({ error: 'Missing wallet identity key' });

    const channelId = String(req.query?.channel_id || '').trim();
    if (!channelId) return res.status(400).json({ error: 'channel_id is required' });

    const wallet = await resolveWalletByToken(authToken, sbGet);
    if (!wallet) return res.status(401).json({ error: 'Invalid wallet identity key' });

    const rows = await sbGet('session_channels', `channel_id=eq.${encodeURIComponent(channelId)}`);
    const session = rows[0];
    if (!session) return res.status(404).json({ error: 'Session channel not found' });
    if (session.identity_key && session.identity_key !== wallet.identity_key) {
      return res.status(403).json({ error: 'Channel does not belong to this wallet identity' });
    }

    return res.status(200).json(sessionProofPayload(session));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
