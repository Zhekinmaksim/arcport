# ArcPort arcOSS Starter Kit

Standalone starter kit for bounded agent payments on Arc.

This folder is designed to be copied into a new repo. It gives builders a small, readable starting point for agents that need paid API/model calls without unlimited wallet access.

## What It Shows

```text
agent receives a bounded policy
  -> opens one USDC session on Arc
  -> makes repeated paid API calls
  -> closes once onchain
  -> refunds unused budget
  -> returns proof
```

The important primitive is the payment session. The agent does not need a new onchain transaction for every `$0.001` call, and the human operator does not need to approve every request.

## What's Included

- TypeScript `ArcPortClient`
- typed session policies
- x402 payment requirement helper
- agent-run demo script
- wagmi/viem frontend notes
- Arc session contract ABI
- architecture notes for self-hosting

## Quickstart

```bash
cd arcoss-starter-kit
cp .env.example .env
npm install
npm run demo
```

You need an ArcPort wallet identity key:

```bash
ARCPORT_IDENTITY_KEY=awi_...
```

By default, the starter kit points at:

```text
https://arcport.xyz
```

You can point it at your own deployment with:

```bash
ARCPORT_URL=https://your-arcport-deployment.example
```

## Demo Agent Flow

The demo script:

1. Opens a session with a `0.01 USDC` budget.
2. Allows only `social-signal` and `gemini`.
3. Makes three paid signal calls.
4. Makes one paid Gemini memo call.
5. Closes the session.
6. Prints the channel ID, open tx, close tx, spend, refund, and proof URL.

Run:

```bash
npm run demo
```

## Use From Your Agent

```ts
import { ArcPortClient } from "./src/index";

const arcport = new ArcPortClient({
  baseUrl: process.env.ARCPORT_URL,
  identityKey: process.env.ARCPORT_IDENTITY_KEY,
});

const session = await arcport.openSession({
  budgetUsdc: "0.01",
  maxCalls: 10,
  allowedApiIds: ["social-signal", "gemini"],
  agentRuntime: "my-agent",
  task: "evaluate paid signals",
});

await arcport.call(session.channelId, "social-signal", {
  symbol: "ETH",
  side: "short",
  score: 0.318,
  drawdown: "14%",
});

await arcport.call(session.channelId, "gemini", {
  prompt: "Write a concise decision memo for this paid agent run.",
});

const closed = await arcport.closeSession(session.channelId);
console.log(closed.proofUrl);
```

## x402 + Session Payments

ArcPort supports two related paths:

- **x402 charge mode**: one paid call.
- **session mode**: repeated paid calls under one bounded budget.

This starter kit focuses on session mode because repeated agent usage is the harder problem. It also includes `getX402Requirements()` so a frontend can show the one-off payment requirement before moving into session policy.

## wagmi/viem Frontend

For a React/Next frontend reference, see:

```text
../examples/next-wagmi-session-client
```

That example shows the wallet-native UI shape:

```text
connect wallet
  -> read x402 requirements
  -> review session policy
  -> open session
  -> call paid APIs
  -> close + refund
  -> inspect proof
```

## Self-Hosting

The hosted demo uses `https://arcport.xyz`, but the starter kit is structured so builders can run the same pattern against their own ArcPort deployment.

Core server endpoints:

```text
POST /api/session-open
POST /api/session-call
POST /api/session-close
GET  /api/session-proof?channel_id=...
POST /api/pay-and-call
```

Core contract:

```text
0x594a7E570d1f915f1e11d504d0e89de28680cC98
```

Arcscan:

```text
https://testnet.arcscan.app/address/0x594a7E570d1f915f1e11d504d0e89de28680cC98?tab=txs
```

## Production Notes

For production, add:

- server-side idempotency keys for all state-changing calls
- per-channel call serialization
- explicit Arc fee policy for close transactions
- typed SDK errors
- frontend wallet policy signing
- self-hosted API provider registry

The current starter kit is intentionally small. It is meant to make the ArcOSS primitive easy to copy, inspect, and extend.

