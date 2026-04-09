// api/wallet.js
// Agent wallet management on ARC Testnet
// Uses local EOA generation — no Circle SDK required
//
// GET  /api/wallet  (Authorization: Bearer apk_...)  — live USDC balance from chain
// POST /api/wallet  { action: "create" }              — create new agent wallet

import { ethers } from 'ethers';

const ARC_RPC      = 'https://rpc.testnet.arc.network';
const ARC_CHAIN_ID = 5042002;
const USDC_ADDRESS = '0x3600000000000000000000000000000000000000';
const ERC20_ABI    = ['function balanceOf(address) view returns (uint256)'];

const sbH = () => ({
  'Content-Type': 'application/json',
  'apikey':        process.env.SUPABASE_ANON_KEY,
  'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`,
});

const genAgentKey = () =>
  'apk_' + Array.from({ length: 32 }, () =>
    'abcdefghijklmnopqrstuvwxyz0123456789'[Math.random() * 36 | 0]
  ).join('');

async function onchainBalance(address) {
  try {
    const provider = new ethers.JsonRpcProvider(ARC_RPC, {
      chainId: ARC_CHAIN_ID,
      name: 'arc-testnet',
    });
    const usdc = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, provider);
    const raw  = await usdc.balanceOf(address);
    return parseFloat(ethers.formatUnits(raw, 6));
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // GET: live balance from ARC chain
  if (req.method === 'GET') {
    const agentKey = (req.headers.authorization || '').replace('Bearer ', '').trim();
    if (!agentKey) return res.status(401).json({ error: 'Missing agent key' });

    const r    = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/agent_wallets?agent_key=eq.${encodeURIComponent(agentKey)}&select=*`,
      { headers: sbH() }
    );
    const rows = await r.json();
    if (!rows[0]) return res.status(404).json({ error: 'Wallet not found' });

    const w       = rows[0];
    const balance = w.arc_address ? await onchainBalance(w.arc_address) : null;

    return res.status(200).json({
      agent_key:      agentKey,
      arc_address:    w.arc_address,
      balance_usdc:   balance ?? w.balance,
      balance_source: balance !== null ? 'onchain' : 'cached',
      network:        'ARC Testnet',
      chain_id:       ARC_CHAIN_ID,
      explorer:       `https://testnet.arcscan.app/address/${w.arc_address}`,
      faucet:         'https://faucet.circle.com',
    });
  }

  // POST: create wallet
  if (req.method === 'POST') {
    const { action } = req.body || {};
    if (action !== 'create') {
      return res.status(400).json({ error: 'Use { action: "create" }' });
    }

    // Generate fresh EOA locally — no external API needed
    const wallet   = ethers.Wallet.createRandom();
    const agentKey = genAgentKey();

    const insert = await fetch(`${process.env.SUPABASE_URL}/rest/v1/agent_wallets`, {
      method: 'POST',
      headers: { ...sbH(), 'Prefer': 'return=minimal' },
      body: JSON.stringify({
        agent_key:   agentKey,
        arc_address: wallet.address,
        balance:     0,
      }),
    });

    if (!insert.ok) {
      console.error('Supabase insert error:', await insert.text());
      return res.status(500).json({ error: 'Failed to save wallet' });
    }

    return res.status(201).json({
      success:     true,
      agent_key:   agentKey,
      arc_address: wallet.address,
      network:     'ARC Testnet',
      chain_id:    ARC_CHAIN_ID,
      explorer:    `https://testnet.arcscan.app/address/${wallet.address}`,
      next_steps: [
        '1. Copy your arc_address',
        '2. Go to https://faucet.circle.com — select ARC Testnet',
        '3. Paste your arc_address — receive 10 USDC free',
        '4. Use your agent_key as Bearer token in API calls',
        '5. Each call costs $0.001 USDC settled onchain',
      ],
    });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
