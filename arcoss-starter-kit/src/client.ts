import { DEFAULT_ARCPORT_URL, arcscanTx } from "./constants";
import { ArcPortConfigError, ArcPortError } from "./errors";
import { normalizePolicy } from "./session-policy";
import type {
  ArcPortConfig,
  CloseSessionResult,
  OpenSessionResult,
  SessionCallResult,
  SessionPolicy,
  SessionProof,
  X402Requirements,
} from "./types";

function trimSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function proofUrl(baseUrl: string, channelId: string) {
  return `${trimSlash(baseUrl)}/api/session-proof?channel_id=${encodeURIComponent(channelId)}`;
}

export class ArcPortClient {
  readonly baseUrl: string;
  readonly identityKey?: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: ArcPortConfig = {}) {
    this.baseUrl = trimSlash(config.baseUrl || DEFAULT_ARCPORT_URL);
    this.identityKey = config.identityKey;
    this.fetchImpl = config.fetchImpl || fetch;
  }

  withIdentity(identityKey: string) {
    return new ArcPortClient({
      baseUrl: this.baseUrl,
      identityKey,
      fetchImpl: this.fetchImpl,
    });
  }

  async getX402Requirements(apiId = "social-signal"): Promise<X402Requirements> {
    const response = await this.fetchImpl(`${this.baseUrl}/api/pay-and-call`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ api_id: apiId, params: {} }),
    });
    const body = await response.json();
    if (response.status !== 402 && !body?.accepts) {
      throw new ArcPortError(body?.error || "Expected x402 payment requirements", response.status, body);
    }
    return body as X402Requirements;
  }

  async openSession(policyInput: Partial<SessionPolicy>): Promise<OpenSessionResult> {
    const policy = normalizePolicy(policyInput);
    const body = await this.request("/api/session-open", {
      deposit_usdc: policy.budgetUsdc,
      max_calls: policy.maxCalls,
      allowed_api_ids: policy.allowedApiIds,
      agent_runtime: policy.agentRuntime,
      task: policy.task,
    });

    return {
      channelId: body.channel_id,
      contractAddress: body.contract_address,
      openTxHash: body.open_tx_hash,
      depositUsdc: body.deposit_usdc,
      maxCalls: body.max_calls,
      allowedApiIds: body.allowed_api_ids || [],
      proofUrl: proofUrl(this.baseUrl, body.channel_id),
      explorer: {
        contract: body.explorer?.contract,
        openTx: body.explorer?.open_tx,
        approveTx: body.explorer?.approve_tx || null,
      },
      raw: body,
    };
  }

  async call<T = unknown>(
    channelId: string,
    apiId: string,
    params: Record<string, unknown> = {},
  ): Promise<SessionCallResult<T>> {
    const body = await this.request("/api/session-call", {
      channel_id: channelId,
      api_id: apiId,
      params,
    });

    return {
      channelId: body.channel_id,
      apiId: body.api?.id || apiId,
      callsTotal: Number(body.session?.calls_total || body.calls_total || 0),
      cumulativeUsdc: Number(body.session?.cumulative_spent || body.cumulative_usdc || 0),
      data: body.data as T,
      raw: body,
    };
  }

  async closeSession(channelId: string): Promise<CloseSessionResult> {
    const body = await this.request("/api/session-close", { channel_id: channelId });
    const closeTxHash = body.close_tx_hash;

    return {
      channelId: body.channel_id,
      closeTxHash,
      callsTotal: Number(body.calls_total || body.session?.calls_total || 0),
      cumulativeUsdc: Number(body.cumulative_usdc || body.session?.cumulative_spent || 0),
      refundUsdc: Number(body.refund_usdc || body.refunded_to_agent_usdc || 0),
      proofUrl: proofUrl(this.baseUrl, body.channel_id),
      explorer: {
        closeTx: body.explorer || (closeTxHash ? arcscanTx(closeTxHash) : ""),
      },
      raw: body,
    };
  }

  async getProof(channelId: string): Promise<SessionProof> {
    return this.request(`/api/session-proof?channel_id=${encodeURIComponent(channelId)}`, undefined, "GET");
  }

  private async request(path: string, body?: unknown, method = "POST") {
    if (!this.identityKey) {
      throw new ArcPortConfigError("Missing ARCPORT_IDENTITY_KEY");
    }

    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.identityKey}`,
        "X-Idempotency-Key": crypto.randomUUID(),
      },
      body: method === "GET" ? undefined : JSON.stringify(body || {}),
    });
    const json = await response.json();
    if (!response.ok) {
      throw new ArcPortError(json?.error || `ArcPort request failed: ${path}`, response.status, json);
    }
    return json;
  }
}

