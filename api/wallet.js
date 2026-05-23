// api/wallet.js — ArcPort wallet management
// GET  /api/wallet (Authorization: Bearer awi_... | apk_...)  — wallet + USDC balance
// POST /api/wallet { action: "create" }                       — create legacy-compatible EOA wallet
// POST /api/wallet { action: "create_circle" }                — create V2 Circle wallet identity

import {
  buildWalletRecord,
  genToken,
  legacyWalletFields,
  publicWalletResponse,
  resolveWalletByToken,
} from './_wallet-identity.js';
import { createDeveloperWallet } from './_circle.js';

const ARC_RPC      = process.env.CANTEEN_ARC_RPC || process.env.ARC_RPC || 'https://rpc.testnet.arc.network';
const USDC_ADDRESS = '0x3600000000000000000000000000000000000000';
const ARC_CHAIN_ID = 5042002;
const sbH = () => ({
  'Content-Type': 'application/json',
  'apikey':        process.env.SUPABASE_ANON_KEY,
  'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`,
});
const sbGet = (table, filter) =>
  fetch(`${process.env.SUPABASE_URL}/rest/v1/${table}?${filter}&select=*`, { headers: sbH() }).then(r => r.json());

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

async function createCircleWallet() {
  const walletSetId  = process.env.CIRCLE_WALLET_SET_ID;
  if (!walletSetId) throw new Error('CIRCLE_WALLET_SET_ID required');
  const wallet = await createDeveloperWallet({ walletSetId });
  return { walletId: wallet.id, address: wallet.address };
}

async function insertWalletRecord(record) {
  const url = `${process.env.SUPABASE_URL}/rest/v1/agent_wallets`;
  const full = await fetch(url, {
    method: 'POST',
    headers: { ...sbH(), 'Prefer': 'return=minimal' },
    body: JSON.stringify(record),
  }).catch(e => { throw new Error('DB error: ' + e.message); });

  if (full.ok) return { storage_mode: 'v2', schema_warning: null };

  const fullText = await full.text();
  const looksLikeLegacySchema =
    full.status === 400 &&
    /column|schema cache|identity_key|wallet_id|gateway_enabled|default_asset|default_network|metadata/i.test(fullText);

  if (!looksLikeLegacySchema) {
    throw new Error('Failed to save wallet: ' + fullText);
  }

  const fallback = await fetch(url, {
    method: 'POST',
    headers: { ...sbH(), 'Prefer': 'return=minimal' },
    body: JSON.stringify(legacyWalletFields(record)),
  }).catch(e => { throw new Error('DB error: ' + e.message); });

  if (!fallback.ok) {
    throw new Error('Failed to save wallet: ' + await fallback.text());
  }

  return {
    storage_mode: 'legacy-schema',
    schema_warning: 'Supabase schema is still on V1. Run the updated schema.sql to persist wallet identities and V2 metadata.',
  };
}

function walletResponsePayload(wallet, extra = {}) {
  const base = publicWalletResponse(wallet);
  return {
    success: true,
    ...base,
    identity: {
      wallet_id: base.wallet_id,
      identity_key: base.identity_key,
      legacy_agent_key: base.agent_key,
      arc_address: base.arc_address,
      wallet_type: base.wallet_type,
      custody_provider: base.custody_provider,
      gateway_enabled: base.gateway_enabled,
    },
    payment_methods: {
      nanopayment: base.wallet_type === 'circle',
      legacy: true,
    },
    ...extra,
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── GET: balance ────────────────────────────────────────
  if (req.method === 'GET') {
    const authToken = (req.headers.authorization || '').replace('Bearer ', '').trim();
    if (!authToken) return res.status(401).json({ error: 'Missing wallet identity key' });

    const wallet = await resolveWalletByToken(authToken, sbGet);
    if (!wallet) return res.status(404).json({ error: 'Wallet not found' });

    const balance = wallet.arc_address ? await onchainBalance(wallet.arc_address) : null;

    return res.status(200).json(walletResponsePayload(wallet, {
      balance_usdc:     balance ?? wallet.balance,
      balance_source:   balance !== null ? 'onchain' : 'cached',
      network:          'ARC Testnet',
      chain_id:         ARC_CHAIN_ID,
      explorer:         `https://testnet.arcscan.app/address/${wallet.arc_address}`,
      faucet:           'https://faucet.circle.com',
    }));
  }

  // ── POST: create wallet ─────────────────────────────────
  if (req.method === 'POST') {
    const { action } = req.body || {};

    // EOA wallet
    if (!action || action === 'create') {
      const { ethers } = await import('ethers');
      const wallet = ethers.Wallet.createRandom();
      const record = buildWalletRecord({
        walletId: genToken('awlt_'),
        identityKey: genToken('awi_'),
        agentKey: genToken('apk_'),
        arcAddress: wallet.address,
        walletType: 'eoa',
      });

      const storage = await insertWalletRecord(record);

      return res.status(201).json(walletResponsePayload(record, {
        storage_mode: storage.storage_mode,
        schema_warning: storage.schema_warning,
        network:       'ARC Testnet',
        chain_id:      ARC_CHAIN_ID,
        explorer:      `https://testnet.arcscan.app/address/${wallet.address}`,
        next_steps: [
          '1. Go to https://faucet.circle.com — select ARC Testnet',
          '2. Paste your arc_address — receive 10 USDC free',
          '3. Use identity_key for V2 clients or agent_key for the current Playground',
        ],
      }));
    }

    // Circle Dev-Controlled wallet
    if (action === 'create_circle') {
      try {
        const cWallet = await createCircleWallet();
        const record = buildWalletRecord({
          walletId: genToken('awlt_'),
          identityKey: genToken('awi_'),
          agentKey: genToken('apk_'),
          arcAddress: cWallet.address,
          circleWalletId: cWallet.walletId,
          walletType: 'circle',
        });

        const storage = await insertWalletRecord(record);

        return res.status(201).json(walletResponsePayload(record, {
          storage_mode: storage.storage_mode,
          schema_warning: storage.schema_warning,
          network:       'ARC Testnet',
          chain_id:      ARC_CHAIN_ID,
          explorer:      `https://testnet.arcscan.app/address/${cWallet.address}`,
          next_steps: [
            '1. Go to https://faucet.circle.com — select ARC Testnet',
            '2. Paste your arc_address — receive 10 USDC free',
            '3. Use identity_key for V2 clients. The current Playground can still use agent_key.',
          ],
        }));
      } catch(e) {
        return res.status(500).json({ error: 'Circle wallet creation failed: ' + e.message });
      }
    }

    return res.status(400).json({ error: 'Unknown action', available: ['create', 'create_circle'] });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
