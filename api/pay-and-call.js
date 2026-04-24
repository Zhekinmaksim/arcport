// api/pay-and-call.js
// ArcPort — pay-per-call API gateway on Arc Testnet
//
// Payment flow (V2 Circle Nanopayments + x402):
//   1. Agent requests API without X-Payment header → 402 + payment requirements
//   2. Agent signs EIP-3009 authorization (gas-free, offchain)
//   3. Agent retries with X-Payment header
//   4. Server verifies via Circle Nanopayments facilitator
//   5. Data returned + receipt recorded
//
import { resolveWalletByToken } from './_wallet-identity.js';
import {
  callMarketplaceApi,
  isBuiltinApi,
  resolveMarketplaceApi,
} from './_marketplace.js';
import {
  ARC_CHAIN_ID,
  ARC_RPC,
  ARC_NETWORK,
  DISPLAY_ASSET,
  DISPLAY_NETWORK,
  PRICE_ATOMIC,
  PRICE_USD,
  USDC_ADDRESS,
  buildPaymentRequirements,
  buildPaymentRequiredResponse,
  normalizeDecodedPayment,
} from './_arcport-payment.js';

const CIRCLE_NP_URL   = 'https://gateway-api-testnet.circle.com/v1/x402';
const X402_FALLBACK   = 'https://x402.org/facilitator';
const LEGACY_PRICE    = BigInt('1000');
const EVM_TX_HASH_RE  = /^0x[a-fA-F0-9]{64}$/;

// ── Supabase ─────────────────────────────────────────────
const sbH    = () => ({ 'Content-Type': 'application/json', 'apikey': process.env.SUPABASE_ANON_KEY, 'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}` });
const sbGet  = (t, f)    => fetch(`${process.env.SUPABASE_URL}/rest/v1/${t}?${f}&select=*`, { headers: sbH() }).then(r => r.json());
const sbPost = (t, body) => fetch(`${process.env.SUPABASE_URL}/rest/v1/${t}`, { method: 'POST', headers: { ...sbH(), 'Prefer': 'return=minimal' }, body: JSON.stringify(body) });
const sbPatch= (t, f, b) => fetch(`${process.env.SUPABASE_URL}/rest/v1/${t}?${f}`, { method: 'PATCH', headers: { ...sbH(), 'Prefer': 'return=minimal' }, body: JSON.stringify(b) });

function resolvePayTo(apiRow) {
  return apiRow?.owner_arc_address || process.env.PLATFORM_ARC_ADDRESS;
}

async function persistTransaction(fullRecord) {
  const legacyRecord = {
    agent_key: fullRecord.agent_key,
    api_id: fullRecord.api_id,
    amount: fullRecord.amount,
    tx_hash: fullRecord.tx_hash,
    arc_address: fullRecord.arc_address,
    status: fullRecord.status,
  };

  const primary = await sbPost('transactions', fullRecord).catch(() => null);
  if (primary?.ok) return;

  const fallback = await sbPost('transactions', legacyRecord).catch(() => null);
  if (!fallback?.ok) {
    console.log('[ArcPort] Failed to persist transaction metadata');
  }
}

// ── Decode X-Payment header ───────────────────────────────
function decodePayment(header) {
  try { return JSON.parse(Buffer.from(header, 'base64').toString()); }
  catch { try { return JSON.parse(header); } catch { return null; } }
}

// ── Verify via Circle Nanopayments ────────────────────────
async function verifyPayment(xPayment, requirements) {
  const paymentPayload = normalizeDecodedPayment(decodePayment(xPayment));
  if (!paymentPayload) return { valid: false, error: 'Invalid X-Payment header encoding' };

  try {
    const r = await fetch(`${CIRCLE_NP_URL}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentPayload, paymentRequirements: requirements }),
      signal: AbortSignal.timeout(8000),
    });
    const d = await r.json();
    if (d.isValid) return { valid: true, facilitator: 'circle-nanopayments', raw: d, payer: d.payer };
    if (d.invalidReason) return { valid: false, error: d.invalidReason };
  } catch (e) {
    console.log('[ArcPort] Circle Nanopayments verify error:', e.message);
  }

  // Fallback: x402.org
  try {
    const r = await fetch(`${X402_FALLBACK}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentPayload, paymentRequirements: requirements }),
      signal: AbortSignal.timeout(8000),
    });
    const d = await r.json();
    if (d.isValid) return { valid: true, facilitator: 'x402-org', raw: d };
    return { valid: false, error: d.invalidReason || 'Payment verification failed' };
  } catch (e) {
    return { valid: false, error: `Facilitator unavailable: ${e.message}` };
  }
}

// ── Settle via Circle Nanopayments ────────────────────────
async function settlePayment(xPayment, requirements) {
  const paymentPayload = normalizeDecodedPayment(decodePayment(xPayment));
  if (!paymentPayload) return { success: false, tx_hash: '', error: 'Invalid X-Payment header encoding' };

  try {
    const r = await fetch(`${CIRCLE_NP_URL}/settle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentPayload, paymentRequirements: requirements }),
      signal: AbortSignal.timeout(10000),
    });
    const d = await r.json();
    const transactionRef = d.transaction || '';
    const txHash = EVM_TX_HASH_RE.test(transactionRef) ? transactionRef : '';
    if (d.success) {
      return {
        success: true,
        tx_hash: txHash,
        settlement_id: transactionRef || null,
        facilitator: 'circle-nanopayments',
        payer: d.payer,
      };
    }
    if (d.errorReason) {
      return { success: false, tx_hash: '', error: d.errorReason, facilitator: 'circle-nanopayments', payer: d.payer };
    }
  } catch (e) {
    console.log('[ArcPort] Circle Nanopayments settle error:', e.message);
  }

  // Fallback
  try {
    const r = await fetch(`${X402_FALLBACK}/settle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paymentPayload, paymentRequirements: requirements }),
      signal: AbortSignal.timeout(10000),
    });
    const d = await r.json();
    return { success: !!d.success, tx_hash: d.txHash || 'x402-settlement', facilitator: 'x402-org' };
  } catch (e) {
    return { success: false, tx_hash: 'settlement-pending', error: e.message, facilitator: 'unknown' };
  }
}

// ── Legacy Arc direct transfer (pure fetch, no ethers) ────
async function legacyTransfer() {
  const { ethers } = await import('ethers');
  const ERC20_ABI  = ['function transfer(address to, uint256 amount) returns (bool)'];
  const provider   = new ethers.JsonRpcProvider(ARC_RPC, { chainId: ARC_CHAIN_ID, name: 'arc-testnet' }, { staticNetwork: true });
  const wallet     = new ethers.Wallet(process.env.ARC_PRIVATE_KEY, provider);
  const usdc       = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, wallet);
  const recipient  = process.env.PLATFORM_ARC_ADDRESS || wallet.address;
  const tx         = await usdc.transfer(recipient, LEGACY_PRICE);
  const receipt    = await tx.wait();
  return receipt.hash;
}

// ── Main handler ──────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Payment, X-Payment-Response, PAYMENT-SIGNATURE, PAYMENT-RESPONSE');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const t0 = Date.now();

  try {
    const { api_id, params = {} } = req.body || {};
    if (!api_id) return res.status(400).json({ error: 'api_id is required' });

    const xPayment = req.headers['x-payment'] || req.headers['payment-signature'];
    const authToken = (req.headers.authorization || '').replace('Bearer ', '').trim();

    // Load custom API from DB if needed
    let apiRow = null;
    if (!isBuiltinApi(api_id)) {
      apiRow = await resolveMarketplaceApi(api_id, sbGet);
      if (!apiRow) return res.status(404).json({ error: `API not found: ${api_id}` });
    }

    const wallet = authToken ? await resolveWalletByToken(authToken, sbGet) : null;
    if (authToken && !wallet) {
      return res.status(401).json({ error: `Invalid ${authToken.startsWith('awi_') ? 'identity key' : 'agent key'}` });
    }

    const payTo = resolvePayTo(apiRow);
    if (!payTo) return res.status(500).json({ error: 'No settlement recipient configured' });

    const requirements = buildPaymentRequirements(payTo, api_id, wallet);
    const paymentRequired = buildPaymentRequiredResponse(requirements, api_id, wallet);

    // ── PATH A: x402 Nanopayment ─────────────────────────
    if (xPayment) {
      const tPay = Date.now();

      const verification = await verifyPayment(xPayment, requirements);
      if (!verification.valid) {
        res.setHeader('PAYMENT-REQUIRED', Buffer.from(JSON.stringify(paymentRequired)).toString('base64'));
        return res.status(402).json({
          ...paymentRequired,
          error: 'Payment verification failed',
          reason: verification.error,
        });
      }

      const settlement = await settlePayment(xPayment, requirements);
      const payMs = Date.now() - tPay;
      if (!settlement.success) {
        res.setHeader('PAYMENT-REQUIRED', Buffer.from(JSON.stringify(paymentRequired)).toString('base64'));
        return res.status(402).json({
          ...paymentRequired,
          error: 'Payment settlement failed',
          reason: settlement.error || 'Settlement failed',
        });
      }

      const { data, error: apiError, latency_ms } = await callMarketplaceApi({
        apiId: api_id,
        params,
        apiRow,
        sbPatch,
      });

      await persistTransaction({
        wallet_id:           wallet?.wallet_id || null,
        identity_key:        wallet?.identity_key || null,
        agent_key:           wallet?.agent_key || (authToken?.startsWith('apk_') ? authToken : 'x402'),
        api_id,
        amount:              0.001,
        tx_hash:             settlement.tx_hash || settlement.settlement_id || 'circle-nanopayment-batched',
        arc_address:         wallet?.arc_address || settlement.payer || verification.payer || 'nanopayment',
        payer_arc_address:   wallet?.arc_address || settlement.payer || verification.payer || null,
        payee_arc_address:   payTo,
        payment_asset:       DISPLAY_ASSET,
        payment_network:     DISPLAY_NETWORK,
        payer_wallet_type:   wallet?.wallet_type || 'external',
        custody_provider:    wallet?.custody_provider || 'external',
        status:              'confirmed',
        payment_type:        'nanopayment',
        settlement_channel:  'x402',
        facilitator:         settlement.facilitator,
      });

      const txHash   = settlement.tx_hash;
      const settlementId = settlement.settlement_id || null;
      const explorer = txHash ? `https://testnet.arcscan.app/tx/${txHash}` : null;

      res.setHeader('X-Payment-Response', Buffer.from(JSON.stringify({
        success: true, txHash, settlementId, network: ARC_NETWORK,
      })).toString('base64'));
      res.setHeader('PAYMENT-RESPONSE', Buffer.from(JSON.stringify({
        success: true,
        txHash,
        settlementId,
        network: ARC_NETWORK,
      })).toString('base64'));

      return res.status(200).json({
        success: true,
        payment: {
          amount:       PRICE_USD,
          currency:     DISPLAY_ASSET,
          network:      DISPLAY_NETWORK,
          payment_type: 'nanopayment',
          settlement_channel: 'x402',
          facilitator:  settlement.facilitator,
          tx_hash:      txHash || null,
          settlement_id: settlementId,
          explorer,
          finality_ms:  payMs,
          gas_fee:      '$0.00',
          note:         txHash
            ? 'Gas-free via Circle Nanopayments. This batch already exposes an onchain transaction hash.'
            : 'Gas-free via Circle Nanopayments. The settlement_id is a Circle batch reference, not an Arc transaction hash. Onchain settlement happens later in batches.',
          payer: wallet ? {
            wallet_id: wallet.wallet_id,
            identity_key: wallet.identity_key,
            arc_address: wallet.arc_address,
            wallet_type: wallet.wallet_type,
          } : (settlement.payer || verification.payer ? { arc_address: settlement.payer || verification.payer } : null),
          payee: {
            arc_address: payTo,
          },
        },
        api:      { id: api_id, latency_ms },
        data,
        error:    apiError || undefined,
        total_ms: Date.now() - t0,
      });
    }

    // ── PATH B: Legacy compatibility flow ────────────────
    if (wallet && authToken?.startsWith('apk_')) {
      if (!process.env.ARC_PRIVATE_KEY) return res.status(500).json({ error: 'ARC_PRIVATE_KEY not configured' });

      const tPay = Date.now();
      const txHash = await legacyTransfer();
      const payMs  = Date.now() - tPay;

      const { data, error: apiError, latency_ms } = await callMarketplaceApi({
        apiId: api_id,
        params,
        apiRow,
        sbPatch,
      });

      await persistTransaction({
        wallet_id:           wallet.wallet_id,
        identity_key:        wallet.identity_key,
        agent_key:           wallet.agent_key,
        api_id,
        amount:              0.001,
        tx_hash:             txHash,
        arc_address:         wallet.arc_address,
        payer_arc_address:   wallet.arc_address,
        payee_arc_address:   payTo,
        payment_asset:       DISPLAY_ASSET,
        payment_network:     DISPLAY_NETWORK,
        payer_wallet_type:   wallet.wallet_type,
        custody_provider:    wallet.custody_provider,
        status:              'confirmed',
        payment_type:        'legacy_direct',
        settlement_channel:  'platform-compat',
      });

      return res.status(200).json({
        success: true,
        payment: {
          amount:       PRICE_USD,
          currency:     DISPLAY_ASSET,
          network:      DISPLAY_NETWORK,
          payment_type: 'legacy_direct',
          settlement_channel: 'platform-compat',
          tx_hash:      txHash,
          explorer:     `https://testnet.arcscan.app/tx/${txHash}`,
          finality_ms:  payMs,
          gas_fee:      '$0.001',
          note:         'Compatibility path for the current Playground. V2 clients should use identity_key + X-Payment.',
          payer: {
            wallet_id: wallet.wallet_id,
            identity_key: wallet.identity_key,
            arc_address: wallet.arc_address,
            wallet_type: wallet.wallet_type,
          },
          payee: {
            arc_address: payTo,
          },
        },
        api:      { id: api_id, latency_ms },
        data,
        error:    apiError || undefined,
        total_ms: Date.now() - t0,
      });
    }

    // ── No payment header / no auth → 402 ────────────────
    res.setHeader('PAYMENT-REQUIRED', Buffer.from(JSON.stringify(paymentRequired)).toString('base64'));
    return res.status(402).json({
      ...paymentRequired,
      error: 'Payment required',
    });

  } catch (err) {
    console.error('[ArcPort] Error:', err);
    return res.status(500).json({ error: err.message });
  }
}
