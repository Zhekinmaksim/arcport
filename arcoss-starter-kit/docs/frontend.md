# Frontend Starter Notes

The frontend shape Canteen asked for is:

```text
React / Next
wagmi / viem
x402 client-side requirements
session policy
ArcOSS primitives
```

ArcPort exposes this as two surfaces:

1. `arcoss-starter-kit` for agent/runtime integration.
2. `examples/next-wagmi-session-client` for a wallet-native frontend reference.

## Frontend Responsibilities

- connect wallet with wagmi
- show x402 payment requirements before a paid call
- show a session policy before the agent spends
- display allowed APIs, max calls, budget, and expiry
- display open tx, close tx, cumulative spend, and refund

## What viem Is Used For

- chain definition for Arc Testnet
- typed contract ABI
- formatting atomic USDC amounts
- future contract reads for `getChannel`
- future wallet-native open/close transactions

## Current Production Path

The hosted ArcPort app currently uses Circle wallet identities for the live session path. This is intentional for the current demo. The frontend starter shows the next wallet-native shape without pretending that delegation/session-key custody is already productionized.

