import { randomBytes } from 'node:crypto';

import { signDeveloperTypedData } from './_circle.js';
import { resolveWalletByToken } from './_wallet-identity.js';
import {
  ARC_CHAIN_ID,
  buildPaymentRequirements,
  buildPaymentResource,
} from './_arcport-payment.js';

const sbH = () => ({
  'Content-Type': 'application/json',
  'apikey': process.env.SUPABASE_ANON_KEY,
  'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`,
});
const sbGet = (table, filter) =>
  fetch(`${process.env.SUPABASE_URL}/rest/v1/${table}?${filter}&select=*`, { headers: sbH() }).then(r => r.json());

const transferTypes = {
  EIP712Domain: [
    { name: 'name', type: 'string' },
    { name: 'version', type: 'string' },
    { name: 'chainId', type: 'uint256' },
    { name: 'verifyingContract', type: 'address' },
  ],
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
};

function resolvePayTo(apiRow) {
  return apiRow?.owner_arc_address || process.env.PLATFORM_ARC_ADDRESS;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const authToken = (req.headers.authorization || '').replace('Bearer ', '').trim();
    if (!authToken) return res.status(401).json({ error: 'Missing wallet identity key' });

    const wallet = await resolveWalletByToken(authToken, sbGet);
    if (!wallet) return res.status(401).json({ error: 'Invalid wallet identity key' });
    if (wallet.wallet_type !== 'circle' || !wallet.circle_wallet_id) {
      return res.status(400).json({ error: 'X-Payment signing requires a Circle wallet identity' });
    }

    const { api_id } = req.body || {};
    if (!api_id) return res.status(400).json({ error: 'api_id is required' });

    const apiRows = await sbGet('apis', `id=eq.${encodeURIComponent(api_id)}`);
    const apiRow = apiRows[0] || null;
    const payTo = resolvePayTo(apiRow);
    if (!payTo) return res.status(500).json({ error: 'No settlement recipient configured' });

    const accepted = buildPaymentRequirements(payTo, api_id, wallet);
    const resource = buildPaymentResource(api_id);

    const validAfter = 0n;
    const validBefore = BigInt(Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 5);
    const authorization = {
      from: wallet.arc_address,
      to: payTo,
      value: accepted.amount,
      validAfter: validAfter.toString(),
      validBefore: validBefore.toString(),
      nonce: `0x${randomBytes(32).toString('hex')}`,
    };

    const typedData = {
      domain: {
        name: accepted.extra?.name || 'GatewayWalletBatched',
        version: accepted.extra?.version || '1',
        chainId: ARC_CHAIN_ID,
        verifyingContract: accepted.extra?.verifyingContract,
      },
      types: transferTypes,
      primaryType: 'TransferWithAuthorization',
      message: {
        from: authorization.from,
        to: authorization.to,
        value: Number(authorization.value),
        validAfter: Number(authorization.validAfter),
        validBefore: Number(authorization.validBefore),
        nonce: authorization.nonce,
      },
    };

    const signature = await signDeveloperTypedData({
      walletId: wallet.circle_wallet_id,
      walletAddress: wallet.arc_address,
      typedData,
      memo: `ArcPort ${api_id} payment authorization`,
    });

    const paymentPayload = {
      x402Version: 2,
      payload: {
        authorization,
        signature,
      },
      resource,
      accepted,
      extensions: {},
    };

    return res.status(200).json({
      success: true,
      x_payment: Buffer.from(JSON.stringify(paymentPayload)).toString('base64'),
      paymentPayload,
      paymentRequirements: accepted,
      resource,
      wallet: {
        wallet_id: wallet.wallet_id,
        identity_key: wallet.identity_key,
        arc_address: wallet.arc_address,
        circle_wallet_id: wallet.circle_wallet_id,
      },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
