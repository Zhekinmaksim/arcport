import { formatUnits } from "viem";
import type { X402Requirements } from "./types";

export function firstRequirement(requirements: X402Requirements) {
  const requirement = requirements.accepts[0];
  if (!requirement) throw new Error("No x402 payment requirement found");
  return requirement;
}

export function formatX402Amount(requirements: X402Requirements) {
  const requirement = firstRequirement(requirements);
  return `${formatUnits(BigInt(requirement.amount), 6)} USDC`;
}

export function describeX402Requirement(requirements: X402Requirements) {
  const requirement = firstRequirement(requirements);
  return {
    amount: formatX402Amount(requirements),
    network: requirement.network,
    asset: requirement.asset,
    payTo: requirement.payTo,
    scheme: requirement.scheme,
  };
}

