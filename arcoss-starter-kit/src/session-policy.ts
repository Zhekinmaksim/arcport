import type { SessionPolicy } from "./types";

export const defaultSessionPolicy: SessionPolicy = {
  budgetUsdc: "0.01",
  maxCalls: 10,
  allowedApiIds: ["social-signal", "gemini"],
  agentRuntime: "arcoss-starter-kit",
  task: "bounded paid API run",
};

export function normalizePolicy(policy: Partial<SessionPolicy> = {}): SessionPolicy {
  const next = {
    ...defaultSessionPolicy,
    ...policy,
    allowedApiIds: policy.allowedApiIds?.length
      ? policy.allowedApiIds
      : defaultSessionPolicy.allowedApiIds,
  };

  if (!next.budgetUsdc || Number(next.budgetUsdc) <= 0) {
    throw new Error("Session budget must be greater than zero");
  }
  if (!Number.isInteger(next.maxCalls) || next.maxCalls <= 0) {
    throw new Error("maxCalls must be a positive integer");
  }
  return next;
}

