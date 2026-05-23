export const PRICE_USD = '0.001';
export const PRICE_ATOMIC = '1000';
export const ARC_CHAIN_ID = 5042002;
export const ARC_NETWORK = 'eip155:5042002';
export const ARC_DOMAIN = 26;
export const ARC_RPC = process.env.CANTEEN_ARC_RPC || process.env.ARC_RPC || 'https://rpc.testnet.arc.network';
export const DISPLAY_NETWORK = 'Arc Testnet';
export const DISPLAY_ASSET = 'USDC';
export const USDC_ADDRESS = '0x3600000000000000000000000000000000000000';
export const GATEWAY_WALLET_CONTRACT = '0x0077777d7EBA4688BDeF3E311b846F25870A19B9';

export function buildPaymentResource(apiId) {
  return {
    url: '/api/pay-and-call',
    description: `ArcPort API gateway — ${apiId} — $${PRICE_USD} USDC per call`,
    mimeType: 'application/json',
  };
}

export function buildPaymentRequirements(payTo, apiId, wallet) {
  return {
    scheme: 'exact',
    network: ARC_NETWORK,
    amount: PRICE_ATOMIC,
    payTo,
    maxTimeoutSeconds: 60,
    asset: USDC_ADDRESS,
    extra: {
      name: 'GatewayWalletBatched',
      version: '1',
      verifyingContract: GATEWAY_WALLET_CONTRACT,
      api_id: apiId,
      assetSymbol: DISPLAY_ASSET,
      settlement_mode: 'arcport-v2',
      payer_wallet_type: wallet?.wallet_type || 'external',
    },
  };
}

export function buildPaymentRequiredResponse(requirements, apiId, wallet) {
  return {
    x402Version: 2,
    accepts: [requirements],
    resource: buildPaymentResource(apiId),
    instructions: {
      nanopayment: 'Create a Circle wallet identity, fund it, deposit USDC into Gateway, then sign and send X-Payment',
      legacy: 'Legacy Authorization-only flow is kept for backend compatibility but not used by the Playground',
      docs: 'https://developers.circle.com/gateway/nanopayments',
    },
    wallet: wallet ? {
      wallet_id: wallet.wallet_id,
      identity_key: wallet.identity_key,
      arc_address: wallet.arc_address,
      wallet_type: wallet.wallet_type,
    } : null,
  };
}

export function normalizeDecodedPayment(decoded) {
  if (!decoded || typeof decoded !== 'object') return null;
  if (decoded.paymentPayload) return decoded.paymentPayload;
  return decoded;
}
