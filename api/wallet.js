// api/wallet.js — ArcPort wallet management
// GET  /api/wallet (Authorization: Bearer apk_...)  — USDC balance
// POST /api/wallet { action: "create" }              — create EOA wallet
// POST /api/wallet { action: "create_circle" }       — create Circle Dev-Controlled wallet

const ARC_RPC      = 'https://rpc.testnet.arc.network';
const USDC_ADDRESS = '0x3600000000000000000000000000000000000000';
const ARC_CHAIN_ID = 5042002;
const CIRCLE_API   = 'https://api.circle.com/v1/w3s';

const sbH = () => ({
  'Content-Type': 'application/json',
  'apikey':        process.env.SUPABASE_ANON_KEY,
  'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`,
});

const circleH = () => ({
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${process.env.CIRCLE_API_KEY}`,
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

async function encryptEntitySecret(entitySecretHex) {
  // Fetch Circle public key
  const r = await fetch(`${CIRCLE_API}/config/entity/publicKey`, { headers: circleH() });
  const d = await r.json();
  const publicKey = d.data?.publicKey;
  if (!publicKey) throw new Error('No public key: ' + JSON.stringify(d));

  // RSA-OAEP encrypt — dynamic import of crypto
  const { publicEncrypt, constants } = await import('node:crypto');
  const encrypted = publicEncrypt(
    { key: publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
    Buffer.from(entitySecretHex, 'hex')
  );
  return encrypted.toString('base64');
}

async function createCircleWallet() {
  const apiKey       = process.env.CIRCLE_API_KEY;
  const entitySecret = process.env.CIRCLE_ENTITY_SECRET;
  const walletSetId  = process.env.CIRCLE_WALLET_SET_ID;
  if (!apiKey || !entitySecret) throw new Error('CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET required');

  const { randomUUID } = await import('node:crypto');

  // Encrypt entity secret fresh each time
  const ciphertext = await encryptEntitySecret(entitySecret);

  // Create wallet
  const wResp = await fetch(`${CIRCLE_API}/developer/wallets`, {
    method: 'POST',
    headers: circleH(),
    body: JSON.stringify({
      idempotencyKey:         randomUUID(),
      accountType:            'EOA',
      blockchains:            ['ARC-TESTNET'],
      count:                  1,
      walletSetId,
      entitySecretCiphertext: ciphertext,
    }),
  });
  const wData = await wResp.json();
  const wallet = wData.data?.wallets?.[0];
  if (!wallet) throw new Error('Circle wallet creation failed: ' + JSON.stringify(wData));

  return { walletId: wallet.id, address: wallet.address };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── GET: balance ────────────────────────────────────────
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

  // ── POST: create wallet ─────────────────────────────────
  if (req.method === 'POST') {
    const { action } = req.body || {};

    // EOA wallet
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
          '1. Go to https://faucet.circle.com — select ARC Testnet',
          '2. Paste your arc_address — receive 10 USDC free',
          '3. Use agent_key as Bearer token in API calls',
        ],
      });
    }

    // Circle Dev-Controlled wallet
    if (action === 'create_circle') {
      try {
        const cWallet  = await createCircleWallet();
        const agentKey = genKey();

        // Save to Supabase with retry
        const saveToDb = async (retries = 3) => {
          for (let i = 0; i < retries; i++) {
            try {
              const r = await fetch(`${process.env.SUPABASE_URL}/rest/v1/agent_wallets`, {
                method: 'POST',
                headers: { ...sbH(), 'Prefer': 'return=minimal' },
                body: JSON.stringify({
                  agent_key:        agentKey,
                  arc_address:      cWallet.address,
                  circle_wallet_id: cWallet.walletId,
                  balance:          0,
                  wallet_type:      'circle',
                }),
              });
              if (r.ok) { console.log('[ArcPort] Supabase saved OK'); return; }
              console.log('[ArcPort] Supabase attempt', i+1, 'status:', r.status);
            } catch(e) {
              console.log('[ArcPort] Supabase attempt', i+1, 'failed:', e.message);
              if (i < retries - 1) await new Promise(r => setTimeout(r, 500));
            }
          }
          console.error('[ArcPort] Supabase save failed after retries');
        };
        saveToDb();

        return res.status(201).json({
          success:          true,
          agent_key:        agentKey,
          arc_address:      cWallet.address,
          circle_wallet_id: cWallet.walletId,
          wallet_type:      'circle',
          network:          'ARC Testnet',
          chain_id:         ARC_CHAIN_ID,
          explorer:         `https://testnet.arcscan.app/address/${cWallet.address}`,
          payment_methods: { nanopayment: true, direct: true },
          next_steps: [
            '1. Go to https://faucet.circle.com — select ARC Testnet',
            '2. Paste your arc_address — receive 10 USDC free',
            '3. Use agent_key in Playground',
          ],
        });
      } catch(e) {
        return res.status(500).json({ error: 'Circle wallet creation failed: ' + e.message });
      }
    }

    return res.status(400).json({ error: 'Unknown action', available: ['create', 'create_circle'] });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
