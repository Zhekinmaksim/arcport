export type ArcPortConfig = {
  baseUrl?: string;
  identityKey?: string;
  fetchImpl?: typeof fetch;
};

export type SessionPolicy = {
  budgetUsdc: string;
  maxCalls: number;
  allowedApiIds: string[];
  agentRuntime: string;
  task: string;
};

export type OpenSessionResult = {
  channelId: string;
  contractAddress: string;
  openTxHash: string;
  depositUsdc: string;
  maxCalls: number;
  allowedApiIds: string[];
  proofUrl: string;
  explorer: {
    contract: string;
    openTx: string;
    approveTx?: string | null;
  };
  raw: unknown;
};

export type SessionCallResult<T = unknown> = {
  channelId: string;
  apiId: string;
  callsTotal: number;
  cumulativeUsdc: number;
  data: T;
  raw: unknown;
};

export type CloseSessionResult = {
  channelId: string;
  closeTxHash: string;
  callsTotal: number;
  cumulativeUsdc: number;
  refundUsdc: number;
  proofUrl: string;
  explorer: {
    closeTx: string;
  };
  raw: unknown;
};

export type SessionProof = {
  channel_id: string;
  contract_address: string;
  status: string;
  calls_total: number;
  cumulative_usdc: number;
  refunded_to_agent_usdc?: number;
  open_tx_hash?: string;
  close_tx_hash?: string;
  explorer?: {
    contract?: string;
    open_tx?: string;
    close_tx?: string;
  };
};

export type X402Requirements = {
  x402Version: number;
  accepts: Array<{
    scheme: string;
    network: string;
    amount: string;
    payTo: string;
    asset: string;
    extra?: Record<string, unknown>;
  }>;
  resource?: {
    url: string;
    description: string;
    mimeType: string;
  };
};

