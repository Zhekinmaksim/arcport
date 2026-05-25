import { parseUnits } from 'viem';

export type SessionPolicy = {
  budgetUsdc: string;
  maxCalls: number;
  expiryMinutes: number;
  allowedApiIds: string[];
  purpose: string;
};

export const defaultPolicy: SessionPolicy = {
  budgetUsdc: '0.01',
  maxCalls: 10,
  expiryMinutes: 30,
  allowedApiIds: ['social-signal', 'gemini'],
  purpose: 'bounded paid API usage for an external agent',
};

export function budgetAtomic(policy: SessionPolicy) {
  return parseUnits(policy.budgetUsdc, 6);
}

export function buildSessionKeyTypedData({
  agent,
  policy,
  verifyingContract,
}: {
  agent: `0x${string}`;
  policy: SessionPolicy;
  verifyingContract: `0x${string}`;
}) {
  return {
    domain: {
      name: 'ArcPort Session Policy',
      version: '1',
      chainId: 5042002,
      verifyingContract,
    },
    types: {
      SessionPolicy: [
        { name: 'agent', type: 'address' },
        { name: 'budget', type: 'uint256' },
        { name: 'maxCalls', type: 'uint256' },
        { name: 'expiryMinutes', type: 'uint256' },
        { name: 'allowedApiHash', type: 'bytes32' },
      ],
    },
    primaryType: 'SessionPolicy',
    message: {
      agent,
      budget: budgetAtomic(policy),
      maxCalls: BigInt(policy.maxCalls),
      expiryMinutes: BigInt(policy.expiryMinutes),
      allowedApiHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
    },
  } as const;
}

