# Architecture

ArcPort session payments separate agent usage from final settlement.

## Runtime Flow

```text
agent runtime
  -> ArcPortClient.openSession(policy)
  -> ArcPort API creates an onchain channel
  -> agent makes repeated paid calls
  -> each call signs a cumulative voucher
  -> close submits final cumulative voucher onchain
  -> contract pays platform and refunds unused budget
```

## Why This Matters

One-off x402 payments are a good primitive for a single API call. Agents usually need repeated calls under a task budget. A bounded session gives the agent a controlled spend envelope without giving it unlimited wallet access.

## Onchain Proof

The contract proves:

- channel opened
- deposit locked
- final cumulative spend
- refund amount
- channel closed

Individual API calls are metered offchain and summarized into the final cumulative close amount.

## Starter Kit Boundaries

This starter kit is a client and integration layer. It does not replace:

- ArcPort server endpoints
- Circle wallet identity signing
- the deployed Solidity session contract
- production API provider registry

It is meant to show the minimum ArcOSS shape builders can copy.

