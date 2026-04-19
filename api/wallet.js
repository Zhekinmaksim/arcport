// api/wallet.js — ArcPort wallet management (simplified)
// GET  /api/wallet (Authorization: Bearer apk_...)  — USDC balance
// POST /api/wallet { action: "create" }              — create EOA wallet

const ARC_RPC      = 'https://rpc.testnet.arc.network';
const USDC_ADDRESS = '0x3600000000000000000000000000000000000000';
const ARC_CHAIN_ID = 5042002;

const sbH = () => ({
  'Content-Type': 'application/json',
  'apikey':        process.env.SUPABASE_ANON_KEY,
  'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`,
});

const genKey = () => 'apk_' + Array.from({ length: 32 }, () =>
  'abcdefghijklmnopqrstuvwxyz0123456789'[Math.random() * 36 | 0]
).join('');

async function onchainBalance(address) {
  try {
    const data = '0x70a08231' + address.slice(2).toLowerCase().padStart(64, '0');
    const r = await fetch(ARC_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_call', params: [{ to: USDC_ADDRESS, data }, 'latest'], id: 1 }),
    });
    const d = await r.json();
    if (d.result && d.result !== '0x') return Number(BigInt(d.result)) / 1e6;
    return 0;
  } catch { return null; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET: balance
  if (req.method === 'GET') {
    const agentKey = (req.headers.authorization || '').replace('Bearer ', '').trim();
    if (!agentKey) return res.status(401).json({ error: 'Missing agent key' });

    const r = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/agent_wallets?agent_key=eq.${encodeURIComponent(agentKey)}&select=*`,
      { headers: sbH() }
    ).catch(e => { throw new Error('DB error: ' + e.message); });

    const rows = await r.json();
    if (!rows[0]) return res.status(404).json({ error: 'Wallet not found' });

    const w       = rows[0];
    const balance = w.arc_address ? await onchainBalance(w.arc_address) : null;

    return res.status(200).json({
      agent_key:        agentKey,
      arc_address:      w.arc_address,
      circle_wallet_id: w.circle_wallet_id || null,
      wallet_type:      w.wallet_type || 'eoa',
      balance_usdc:     balance ?? w.balance,
      balance_source:   balance !== null ? 'onchain' : 'cached',
      network:          'ARC Testnet',
      chain_id:         ARC_CHAIN_ID,
      explorer:         `https://testnet.arcscan.app/address/${w.arc_address}`,
      faucet:           'https://faucet.circle.com',
    });
  }

  // POST: create wallet
  if (req.method === 'POST') {
    const { action } = req.body || {};

    if (!action || action === 'create') {
      const { ethers } = await import('ethers');
      const wallet   = ethers.Wallet.createRandom();
      const agentKey = genKey();

      const insert = await fetch(`${process.env.SUPABASE_URL}/rest/v1/agent_wallets`, {
        method: 'POST',
        headers: { ...sbH(), 'Prefer': 'return=minimal' },
        body: JSON.stringify({ agent_key: agentKey, arc_address: wallet.address, balance: 0, wallet_type: 'eoa' }),
      }).catch(e => { throw new Error('DB error: ' + e.message); });

      if (!insert.ok) return res.status(500).json({ error: 'Failed to save wallet: ' + await insert.text() });

      return res.status(201).json({
        success:     true,
        agent_key:   agentKey,
        arc_address: wallet.address,
        wallet_type: 'eoa',
        network:     'ARC Testnet',
        chain_id:    ARC_CHAIN_ID,
        explorer:    `https://testnet.arcscan.app/address/${wallet.address}`,
        next_steps: [
          '1. Copy your arc_address',
          '2. Go to https://faucet.circle.com — select ARC Testnet',
          '3. Paste your arc_address — receive 10 USDC free',
          '4. Use your agent_key as Bearer token in API calls',
        ],
      });
    }

    // Circle wallet — temporarily disabled
    if (action === 'create_circle') {
      return res.status(503).json({
        error: 'Circle Wallet creation temporarily unavailable',
        fallback: 'Use EOA wallet: POST { action: "create" }',
      });
    }

    return res.status(400).json({ error: 'Unknown action', available: ['create'] });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
