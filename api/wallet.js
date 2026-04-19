// api/wallet.js
// ArcPort — Agent wallet management
//
// Two wallet types:
//   1. Legacy EOA (apk_ key) — direct Arc transfer, ethers.js
//   2. Circle Dev-Controlled Wallet — for x402 Nanopayments
//
// GET  /api/wallet (Authorization: Bearer apk_...)  — balance from chain
// POST /api/wallet { action: "create" }              — create EOA wallet
// POST /api/wallet { action: "create_circle" }       — create Circle wallet
// POST /api/wallet { action: "fund_faucet", address } — fund via Circle faucet API
// GET  /api/wallet?type=gateway (Authorization: Bearer apk_...) — Gateway balance

import { ethers } from 'ethers';
import { randomUUID } from 'crypto';

const ARC_RPC         = 'https://rpc.testnet.arc.network';
const ARC_CHAIN_ID    = 5042002;
const USDC_ADDRESS    = '0x3600000000000000000000000000000000000000';
const ERC20_ABI       = ['function balanceOf(address) view returns (uint256)'];
const CIRCLE_API_BASE = 'https://api.circle.com/v1/w3s';
const GATEWAY_API     = 'https://gateway-api-testnet.circle.com/v1';

// ── Supabase ─────────────────────────────────────────────
const sbH = () => ({
  'Content-Type': 'application/json',
  'apikey':        process.env.SUPABASE_ANON_KEY,
  'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`,
});
const sbGet  = (t, f)    => fetch(`${process.env.SUPABASE_URL}/rest/v1/${t}?${f}&select=*`, { headers: sbH() }).then(r => r.json());
const sbPost = (t, body) => fetch(`${process.env.SUPABASE_URL}/rest/v1/${t}`, { method: 'POST', headers: { ...sbH(), 'Prefer': 'return=minimal' }, body: JSON.stringify(body) });
const sbPatch= (t, f, b) => fetch(`${process.env.SUPABASE_URL}/rest/v1/${t}?${f}`, { method: 'PATCH', headers: { ...sbH(), 'Prefer': 'return=minimal' }, body: JSON.stringify(b) });

// ── Agent key generator ───────────────────────────────────
const genKey = (prefix = 'apk') =>
  prefix + '_' + Array.from({ length: 32 }, () =>
    'abcdefghijklmnopqrstuvwxyz0123456789'[Math.random() * 36 | 0]
  ).join('');

// ── Circle API helper ─────────────────────────────────────
const circleH = () => ({
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${process.env.CIRCLE_API_KEY}`,
});

// ── Onchain USDC balance ──────────────────────────────────
async function onchainBalance(address) {
  try {
    const provider = new ethers.JsonRpcProvider(ARC_RPC, { chainId: ARC_CHAIN_ID, name: 'arc-testnet' });
    const usdc = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, provider);
    const raw  = await usdc.balanceOf(address);
    return parseFloat(ethers.formatUnits(raw, 6));
  } catch {
    return null;
  }
}

// ── Circle Dev-Controlled Wallet setup ────────────────────
// Requires CIRCLE_ENTITY_SECRET in env (set once via Circle Console)
async function createCircleWallet() {
  const apiKey      = process.env.CIRCLE_API_KEY;
  const entitySecret= process.env.CIRCLE_ENTITY_SECRET;
  if (!apiKey || !entitySecret) throw new Error('CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET required');

  // 1. Get or create wallet set
  let walletSetId = process.env.CIRCLE_WALLET_SET_ID;
  if (!walletSetId) {
    const wsResp = await fetch(`${CIRCLE_API_BASE}/developer/walletSets`, {
      method: 'POST',
      headers: circleH(),
      body: JSON.stringify({
        idempotencyKey: randomUUID(),
        name: 'ArcPort Agents',
        entitySecretCiphertext: entitySecret,
      }),
    });
    const wsData = await wsResp.json();
    walletSetId  = wsData.data?.walletSet?.id;
    if (!walletSetId) throw new Error('Failed to create wallet set: ' + JSON.stringify(wsData));
  }

  // 2. Create wallet on ARC-TESTNET
  const wResp = await fetch(`${CIRCLE_API_BASE}/developer/wallets`, {
    method: 'POST',
    headers: circleH(),
    body: JSON.stringify({
      idempotencyKey:          randomUUID(),
      accountType:             'EOA',
      blockchains:             ['ARC-TESTNET'],
      count:                   1,
      walletSetId,
      entitySecretCiphertext:  entitySecret,
    }),
  });
  const wData = await wResp.json();
  const wallet = wData.data?.wallets?.[0];
  if (!wallet) throw new Error('Failed to create Circle wallet: ' + JSON.stringify(wData));

  return {
    walletId:   wallet.id,
    address:    wallet.address,
    blockchain: wallet.blockchain,
    walletSetId,
  };
}

// ── Fund wallet via Circle Faucet API ─────────────────────
async function fundViaFaucet(address) {
  const r = await fetch('https://api.circle.com/v1/faucet/drips', {
    method: 'POST',
    headers: circleH(),
    body: JSON.stringify({
      address,
      blockchain: 'ARC-TESTNET',
      usdc: true,
    }),
  });
  const data = await r.json();
  return data;
}

// ── Gateway balance ───────────────────────────────────────
async function getGatewayBalance(address) {
  try {
    const r = await fetch(`${GATEWAY_API}/balance/${address}`, {
      headers: circleH(),
    });
    const data = await r.json();
    return data;
  } catch {
    return null;
  }
}

// ── Main handler ──────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── GET: balance ─────────────────────────────────────────
  if (req.method === 'GET') {
    const agentKey = (req.headers.authorization || '').replace('Bearer ', '').trim();
    if (!agentKey) return res.status(401).json({ error: 'Missing agent key' });

    const rows = await sbGet('agent_wallets', `agent_key=eq.${encodeURIComponent(agentKey)}`);
    if (!rows[0]) return res.status(404).json({ error: 'Wallet not found' });

    const w       = rows[0];
    const balance = w.arc_address ? await onchainBalance(w.arc_address) : null;

    // If it's a Circle wallet, also fetch Circle wallet balance
    let circleBalance = null;
    if (w.circle_wallet_id && process.env.CIRCLE_API_KEY) {
      try {
        const r = await fetch(`${CIRCLE_API_BASE}/wallets/${w.circle_wallet_id}/balances`, {
          headers: circleH(),
        });
        const d = await r.json();
        const usdcToken = d.data?.tokenBalances?.find(t => t.token?.symbol === 'USDC');
        if (usdcToken) circleBalance = parseFloat(usdcToken.amount);
      } catch { /* ignore */ }
    }

    // Gateway balance
    let gatewayBalance = null;
    if (w.arc_address && req.query?.type === 'gateway') {
      const gd = await getGatewayBalance(w.arc_address);
      if (gd?.availableBalance) gatewayBalance = gd.availableBalance;
    }

    return res.status(200).json({
      agent_key:         agentKey,
      arc_address:       w.arc_address,
      circle_wallet_id:  w.circle_wallet_id || null,
      balance_usdc:      balance ?? w.balance,
      circle_balance:    circleBalance,
      gateway_balance:   gatewayBalance,
      balance_source:    balance !== null ? 'onchain' : 'cached',
      network:           'ARC Testnet',
      chain_id:          ARC_CHAIN_ID,
      explorer:          w.arc_address ? `https://testnet.arcscan.app/address/${w.arc_address}` : null,
      faucet:            'https://faucet.circle.com',
      payment_types: {
        legacy:      !!w.arc_address,
        nanopayment: !!w.circle_wallet_id,
      },
    });
  }

  // ── POST: create wallet or fund ───────────────────────────
  if (req.method === 'POST') {
    const { action, address } = req.body || {};

    // ── Create legacy EOA wallet ──────────────────────────
    if (!action || action === 'create') {
      const wallet   = ethers.Wallet.createRandom();
      const agentKey = genKey('apk');

      const insert = await fetch(`${process.env.SUPABASE_URL}/rest/v1/agent_wallets`, {
        method: 'POST',
        headers: { ...sbH(), 'Prefer': 'return=minimal' },
        body: JSON.stringify({
          agent_key:   agentKey,
          arc_address: wallet.address,
          balance:     0,
          wallet_type: 'eoa',
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
        wallet_type: 'eoa',
        network:     'ARC Testnet',
        chain_id:    ARC_CHAIN_ID,
        explorer:    `https://testnet.arcscan.app/address/${wallet.address}`,
        payment_methods: {
          legacy:      true,
          nanopayment: false,
          note:        'Fund at faucet.circle.com to use legacy payments. For Nanopayments, use create_circle action.',
        },
        next_steps: [
          '1. Copy your arc_address',
          '2. Go to https://faucet.circle.com — select ARC Testnet',
          '3. Paste your arc_address — receive 10 USDC free',
          '4. Use your agent_key as Bearer token in API calls',
        ],
      });
    }

    // ── Create Circle Dev-Controlled Wallet ───────────────
    if (action === 'create_circle') {
      if (!process.env.CIRCLE_API_KEY || !process.env.CIRCLE_ENTITY_SECRET) {
        return res.status(503).json({
          error: 'Circle Wallets not configured on this server',
          note: 'CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET must be set in Vercel env',
        });
      }

      try {
        const cWallet  = await createCircleWallet();
        const agentKey = genKey('apk');

        await fetch(`${process.env.SUPABASE_URL}/rest/v1/agent_wallets`, {
          method: 'POST',
          headers: { ...sbH(), 'Prefer': 'return=minimal' },
          body: JSON.stringify({
            agent_key:         agentKey,
            arc_address:       cWallet.address,
            circle_wallet_id:  cWallet.walletId,
            balance:           0,
            wallet_type:       'circle',
          }),
        });

        return res.status(201).json({
          success:           true,
          agent_key:         agentKey,
          arc_address:       cWallet.address,
          circle_wallet_id:  cWallet.walletId,
          wallet_type:       'circle',
          network:           'ARC Testnet',
          explorer:          `https://testnet.arcscan.app/address/${cWallet.address}`,
          payment_methods: {
            legacy:      true,
            nanopayment: true,
            note:        'This wallet supports both direct Arc transfers and gas-free Circle Nanopayments via x402',
          },
          next_steps: [
            '1. Fund with faucet at https://faucet.circle.com — select ARC Testnet',
            '2. Or call POST /api/wallet { action: "fund_faucet", address: "0x..." }',
            '3. Deposit USDC to Gateway Wallet for Nanopayments (gas-free)',
            '4. Use agent_key as Bearer token — pays via Nanopayments automatically',
          ],
        });
      } catch (e) {
        return res.status(500).json({ error: 'Circle wallet creation failed: ' + e.message });
      }
    }

    // ── Fund via Circle Faucet API ─────────────────────────
    if (action === 'fund_faucet') {
      if (!address) return res.status(400).json({ error: 'address is required' });
      if (!process.env.CIRCLE_API_KEY) return res.status(503).json({ error: 'CIRCLE_API_KEY not configured' });

      try {
        const result = await fundViaFaucet(address);
        return res.status(200).json({
          success: true,
          address,
          faucet_response: result,
          note: 'USDC will arrive on ARC Testnet within ~30 seconds',
        });
      } catch (e) {
        return res.status(500).json({ error: 'Faucet request failed: ' + e.message });
      }
    }

    return res.status(400).json({
      error: 'Unknown action',
      available_actions: ['create', 'create_circle', 'fund_faucet'],
    });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
