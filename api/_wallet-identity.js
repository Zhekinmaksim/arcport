import { randomBytes } from 'node:crypto';

export const WALLET_ID_PREFIX = 'awlt_';
export const IDENTITY_KEY_PREFIX = 'awi_';
export const LEGACY_AGENT_KEY_PREFIX = 'apk_';

export function genToken(prefix, bytes = 18) {
  return prefix + randomBytes(bytes).toString('hex');
}

export function tokenColumn(token = '') {
  if (token.startsWith(WALLET_ID_PREFIX)) return 'wallet_id';
  if (token.startsWith(IDENTITY_KEY_PREFIX)) return 'identity_key';
  return 'agent_key';
}

export function normalizeWalletRow(row = {}) {
  if (!row || typeof row !== 'object') return null;

  const walletType = row.wallet_type || (row.circle_wallet_id ? 'circle' : 'eoa');
  const custodyProvider = row.custody_provider || (walletType === 'circle' ? 'circle' : 'self');

  return {
    ...row,
    wallet_id: row.wallet_id || row.id || null,
    identity_key: row.identity_key || null,
    agent_key: row.agent_key || null,
    arc_address: row.arc_address ? String(row.arc_address).trim() : null,
    circle_wallet_id: row.circle_wallet_id || null,
    wallet_type: walletType,
    custody_provider: custodyProvider,
    default_asset: row.default_asset || 'USDC',
    default_network: row.default_network || 'ARC-TESTNET',
    gateway_enabled: row.gateway_enabled ?? (walletType === 'circle'),
    status: row.status || 'active',
    metadata: row.metadata || {},
  };
}

export function buildWalletRecord({
  walletId,
  identityKey,
  agentKey,
  arcAddress,
  circleWalletId = null,
  walletType = 'eoa',
  defaultAsset = 'USDC',
  defaultNetwork = 'ARC-TESTNET',
}) {
  return normalizeWalletRow({
    wallet_id: walletId,
    identity_key: identityKey,
    agent_key: agentKey,
    arc_address: arcAddress,
    circle_wallet_id: circleWalletId,
    wallet_type: walletType,
    custody_provider: walletType === 'circle' ? 'circle' : 'self',
    default_asset: defaultAsset,
    default_network: defaultNetwork,
    gateway_enabled: walletType === 'circle',
    status: 'active',
    balance: 0,
    metadata: {
      version: 'v2',
      created_via: walletType === 'circle' ? 'circle-wallets' : 'eoa',
    },
  });
}

export function legacyWalletFields(wallet) {
  return {
    agent_key: wallet.agent_key,
    arc_address: wallet.arc_address,
    circle_wallet_id: wallet.circle_wallet_id,
    balance: wallet.balance ?? 0,
    wallet_type: wallet.wallet_type,
  };
}

export function publicWalletResponse(wallet) {
  const row = normalizeWalletRow(wallet);
  return {
    wallet_id: row.wallet_id,
    identity_key: row.identity_key,
    agent_key: row.agent_key,
    arc_address: row.arc_address,
    circle_wallet_id: row.circle_wallet_id,
    wallet_type: row.wallet_type,
    custody_provider: row.custody_provider,
    default_asset: row.default_asset,
    default_network: row.default_network,
    gateway_enabled: row.gateway_enabled,
    status: row.status,
  };
}

export async function resolveWalletByToken(token, sbGet) {
  if (!token) return null;
  const column = tokenColumn(token);
  const rows = await sbGet('agent_wallets', `${column}=eq.${encodeURIComponent(token)}`);
  return Array.isArray(rows) && rows[0] ? normalizeWalletRow(rows[0]) : null;
}
