import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { Contract, getAddress, Interface, JsonRpcProvider, parseUnits } from 'ethers';

import {
  ARC_CHAIN_ID,
  ARC_RPC,
  PRICE_ATOMIC,
  PRICE_USD,
  USDC_ADDRESS,
} from './_arcport-payment.js';

export const SESSION_PRICE_USD = PRICE_USD;
export const SESSION_PRICE_ATOMIC = PRICE_ATOMIC;
export const SESSION_OPEN_BUFFER_ATOMIC = '10000'; // 0.01 USDC buffer for approve/open gas.

export const SESSION_CHANNEL_ABI = [
  'event ChannelOpened(bytes32 indexed channelId, address indexed agent, uint256 deposit, uint256 expiry)',
  'event ChannelClosed(bytes32 indexed channelId, uint256 paidToPlatform, uint256 refundedToAgent)',
  'event ChannelExpired(bytes32 indexed channelId, uint256 refundedToAgent)',
  'function open(uint256 deposit) returns (bytes32 channelId)',
  'function close(bytes32 channelId, uint256 cumulative, bytes signature)',
  'function expire(bytes32 channelId)',
  'function verifyVoucher(bytes32 channelId, uint256 cumulative, bytes signature) view returns (address signer)',
  'function getChannel(bytes32 channelId) view returns (address agent, uint256 deposit, uint256 expiry, uint256 withdrawn, bool closed, uint256 remainingCalls)',
];

export const SESSION_VOUCHER_TYPES = {
  EIP712Domain: [
    { name: 'name', type: 'string' },
    { name: 'version', type: 'string' },
    { name: 'chainId', type: 'uint256' },
    { name: 'verifyingContract', type: 'address' },
  ],
  Voucher: [
    { name: 'channelId', type: 'bytes32' },
    { name: 'cumulative', type: 'uint256' },
  ],
};

const sessionInterface = new Interface(SESSION_CHANNEL_ABI);

export function normalizeAddress(value, label = 'address') {
  const raw = String(value || '').trim();
  try {
    return getAddress(raw);
  } catch (_) {
    throw new Error(`${label} must be a valid 0x address`);
  }
}

function readLocalEnvValue(name) {
  const envPath = path.join(process.cwd(), '.env.local');
  if (!existsSync(envPath)) return null;

  const match = readFileSync(envPath, 'utf8')
    .split('\n')
    .map(line => line.trim())
    .find(line => line.startsWith(`${name}=`));

  if (!match) return null;
  return match.slice(name.length + 1).trim();
}

export function getSessionContractAddress() {
  const address = process.env.SESSION_CHANNEL_CONTRACT || readLocalEnvValue('SESSION_CHANNEL_CONTRACT');
  if (!address) throw new Error('SESSION_CHANNEL_CONTRACT required');
  return normalizeAddress(address, 'SESSION_CHANNEL_CONTRACT');
}

export function getSessionProvider() {
  return new JsonRpcProvider(
    ARC_RPC,
    { chainId: ARC_CHAIN_ID, name: 'arc-testnet' },
    { staticNetwork: true }
  );
}

export async function getUsdcBalanceAtomic(address) {
  if (!address) return 0n;
  const owner = normalizeAddress(address, 'wallet address');
  const provider = getSessionProvider();
  const usdc = new Contract(normalizeAddress(USDC_ADDRESS, 'USDC_ADDRESS'), ['function balanceOf(address) view returns (uint256)'], provider);
  return BigInt((await usdc.balanceOf(owner)).toString());
}

export async function getUsdcAllowanceAtomic(owner, spender) {
  if (!owner || !spender) return 0n;
  const normalizedOwner = normalizeAddress(owner, 'wallet address');
  const normalizedSpender = normalizeAddress(spender, 'session contract address');
  const provider = getSessionProvider();
  const usdc = new Contract(normalizeAddress(USDC_ADDRESS, 'USDC_ADDRESS'), ['function allowance(address,address) view returns (uint256)'], provider);
  return BigInt((await usdc.allowance(normalizedOwner, normalizedSpender)).toString());
}

export function getSessionDeposit({ depositUsdc, expectedCalls } = {}) {
  if (depositUsdc !== undefined && depositUsdc !== null && depositUsdc !== '') {
    const normalized = Number(depositUsdc);
    if (!Number.isFinite(normalized) || normalized <= 0) {
      throw new Error('deposit_usdc must be a positive number');
    }
    return {
      deposit_usdc: normalized,
      deposit_atomic: parseUnits(String(normalized), 6).toString(),
      expected_calls: Math.floor(normalized / Number(SESSION_PRICE_USD)),
    };
  }

  if (expectedCalls !== undefined && expectedCalls !== null && expectedCalls !== '') {
    const normalized = Number(expectedCalls);
    if (!Number.isFinite(normalized) || normalized <= 0) {
      throw new Error('expected_calls must be a positive number');
    }
    const deposit = normalized * Number(SESSION_PRICE_USD);
    return {
      deposit_usdc: Number(deposit.toFixed(3)),
      deposit_atomic: (BigInt(Math.floor(normalized)) * BigInt(SESSION_PRICE_ATOMIC)).toString(),
      expected_calls: Math.floor(normalized),
    };
  }

  return {
    deposit_usdc: 1.0,
    deposit_atomic: parseUnits('1.0', 6).toString(),
    expected_calls: Math.floor(1 / Number(SESSION_PRICE_USD)),
  };
}

export async function parseOpenedChannel({ txHash, contractAddress }) {
  const provider = getSessionProvider();
  const receipt = await provider.getTransactionReceipt(txHash);
  if (!receipt) throw new Error(`Receipt not found for ${txHash}`);
  const normalizedContract = normalizeAddress(contractAddress, 'session contract address').toLowerCase();

  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== normalizedContract) continue;
    try {
      const parsed = sessionInterface.parseLog(log);
      if (parsed?.name === 'ChannelOpened') {
        return {
          channel_id: parsed.args.channelId,
          agent: parsed.args.agent,
          deposit_atomic: parsed.args.deposit.toString(),
          expiry_unix: Number(parsed.args.expiry),
          receipt,
        };
      }
    } catch (_) {
      // ignore non-matching logs
    }
  }

  throw new Error('ChannelOpened event not found in receipt');
}

export async function getOnchainChannel(channelId, contractAddress) {
  const provider = getSessionProvider();
  const contract = new Contract(normalizeAddress(contractAddress, 'session contract address'), SESSION_CHANNEL_ABI, provider);
  const channel = await contract.getChannel(channelId);
  return {
    agent: channel[0],
    deposit: channel[1].toString(),
    expiry: Number(channel[2]),
    withdrawn: channel[3].toString(),
    closed: Boolean(channel[4]),
    remaining_calls: Number(channel[5]),
  };
}

export async function verifySessionVoucher({ channelId, cumulative, signature, contractAddress }) {
  const provider = getSessionProvider();
  const contract = new Contract(normalizeAddress(contractAddress, 'session contract address'), SESSION_CHANNEL_ABI, provider);
  return contract.verifyVoucher(channelId, cumulative, signature);
}

export async function parseClosedChannel({ txHash, contractAddress }) {
  const provider = getSessionProvider();
  const receipt = await provider.getTransactionReceipt(txHash);
  if (!receipt) throw new Error(`Receipt not found for ${txHash}`);
  const normalizedContract = normalizeAddress(contractAddress, 'session contract address').toLowerCase();

  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== normalizedContract) continue;
    try {
      const parsed = sessionInterface.parseLog(log);
      if (parsed?.name === 'ChannelClosed') {
        return {
          channel_id: parsed.args.channelId,
          paid_to_platform_atomic: parsed.args.paidToPlatform.toString(),
          refunded_to_agent_atomic: parsed.args.refundedToAgent.toString(),
          receipt,
        };
      }
    } catch (_) {
      // ignore non-matching logs
    }
  }

  throw new Error('ChannelClosed event not found in receipt');
}

export function buildSessionVoucherTypedData(channelId, cumulative, contractAddress) {
  return {
    domain: {
      name: 'ArcStreamChannel',
      version: '1',
      chainId: ARC_CHAIN_ID,
      verifyingContract: normalizeAddress(contractAddress, 'session contract address'),
    },
    types: SESSION_VOUCHER_TYPES,
    primaryType: 'Voucher',
    message: {
      channelId,
      cumulative: String(cumulative),
    },
  };
}

export { USDC_ADDRESS, sessionInterface };
