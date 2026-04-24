import { constants, createHash, publicEncrypt, randomUUID } from 'node:crypto';

export const CIRCLE_W3S_API = 'https://api.circle.com/v1/w3s';
export const ARC_BLOCKCHAIN = 'ARC-TESTNET';
const MAX_REF_ID_LENGTH = 100;
const CIRCLE_REQUEST_TIMEOUT_MS = 20000;

function circleHeaders() {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${process.env.CIRCLE_API_KEY}`,
  };
}

function normalizeRefId(refId) {
  if (!refId) return undefined;
  if (refId.length <= MAX_REF_ID_LENGTH) return refId;

  const digest = createHash('sha256').update(refId).digest('hex').slice(0, 16);
  const head = refId.slice(0, MAX_REF_ID_LENGTH - digest.length - 1);
  return `${head}-${digest}`;
}

async function circleFetch(url, options = {}) {
  return fetch(url, {
    ...options,
    signal: options.signal || AbortSignal.timeout(CIRCLE_REQUEST_TIMEOUT_MS),
  });
}

export async function encryptEntitySecret() {
  const entitySecretHex = process.env.CIRCLE_ENTITY_SECRET;
  if (!process.env.CIRCLE_API_KEY || !entitySecretHex) {
    throw new Error('CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET are required');
  }

  const r = await circleFetch(`${CIRCLE_W3S_API}/config/entity/publicKey`, {
    headers: circleHeaders(),
  });
  const d = await r.json();
  const publicKey = d.data?.publicKey;
  if (!r.ok || !publicKey) {
    throw new Error('Unable to fetch Circle entity public key');
  }

  const encrypted = publicEncrypt(
    { key: publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
    Buffer.from(entitySecretHex, 'hex')
  );
  return encrypted.toString('base64');
}

export async function createDeveloperWallet({ walletSetId, blockchains = [ARC_BLOCKCHAIN] }) {
  const entitySecretCiphertext = await encryptEntitySecret();
  const r = await circleFetch(`${CIRCLE_W3S_API}/developer/wallets`, {
    method: 'POST',
    headers: circleHeaders(),
    body: JSON.stringify({
      idempotencyKey: randomUUID(),
      accountType: 'EOA',
      blockchains,
      count: 1,
      walletSetId,
      entitySecretCiphertext,
    }),
  });
  const d = await r.json();
  const wallet = d.data?.wallets?.[0];
  if (!r.ok || !wallet) {
    throw new Error('Circle wallet creation failed: ' + JSON.stringify(d));
  }
  return wallet;
}

export async function signDeveloperTypedData({ walletId, walletAddress, typedData, memo }) {
  const entitySecretCiphertext = await encryptEntitySecret();
  const body = {
    entitySecretCiphertext,
    memo,
    data: JSON.stringify(typedData),
  };

  if (walletAddress) {
    body.walletAddress = walletAddress;
    body.blockchain = ARC_BLOCKCHAIN;
  } else if (walletId) {
    body.walletId = walletId;
  } else {
    throw new Error('walletId or walletAddress is required');
  }

  const r = await circleFetch(`${CIRCLE_W3S_API}/developer/sign/typedData`, {
    method: 'POST',
    headers: circleHeaders(),
    body: JSON.stringify(body),
  });
  const d = await r.json();
  const signature = d.data?.signature;
  if (!r.ok || !signature) {
    throw new Error('Circle typed data signing failed: ' + JSON.stringify(d));
  }
  return signature;
}

export async function createContractExecution({
  walletId,
  walletAddress,
  contractAddress,
  abiFunctionSignature,
  abiParameters,
  refId,
}) {
  const entitySecretCiphertext = await encryptEntitySecret();
  const body = {
    idempotencyKey: randomUUID(),
    entitySecretCiphertext,
    contractAddress,
    abiFunctionSignature,
    abiParameters,
    feeLevel: 'MEDIUM',
    refId: normalizeRefId(refId),
  };

  if (walletAddress) {
    body.walletAddress = walletAddress;
    body.blockchain = ARC_BLOCKCHAIN;
  } else if (walletId) {
    body.walletId = walletId;
  } else {
    throw new Error('walletId or walletAddress is required');
  }

  const r = await circleFetch(`${CIRCLE_W3S_API}/developer/transactions/contractExecution`, {
    method: 'POST',
    headers: circleHeaders(),
    body: JSON.stringify(body),
  });
  const d = await r.json();
  const txId = d.data?.id;
  if (!r.ok || !txId) {
    throw new Error('Circle contract execution failed: ' + JSON.stringify(d));
  }
  return txId;
}

export async function getDeveloperTransaction(id) {
  const r = await circleFetch(`${CIRCLE_W3S_API}/transactions/${id}`, {
    headers: circleHeaders(),
  });
  const d = await r.json();
  const tx = d.data?.transaction;
  if (!r.ok || !tx) {
    throw new Error('Circle transaction lookup failed: ' + JSON.stringify(d));
  }
  return tx;
}

export async function waitForDeveloperTransaction(id, { timeoutMs = 120000, intervalMs = 3000 } = {}) {
  const terminalStates = new Set(['COMPLETE', 'FAILED', 'CANCELLED', 'DENIED']);
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const tx = await getDeveloperTransaction(id);
    if (terminalStates.has(tx.state)) return tx;
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }

  throw new Error(`Timed out waiting for Circle transaction ${id}`);
}

export async function getGatewayBalances({ depositor, domain }) {
  const r = await fetch('https://gateway-api-testnet.circle.com/v1/balances', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token: 'USDC',
      sources: [{ depositor, domain }],
    }),
  });
  const d = await r.json();
  if (!r.ok) {
    throw new Error('Gateway balance lookup failed: ' + JSON.stringify(d));
  }
  return d.balances || [];
}
