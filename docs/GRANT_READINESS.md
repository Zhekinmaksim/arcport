# ArcPort V3 Grant Readiness

ArcPort should be submitted as agent payment infrastructure on Arc, not as a hackathon demo.

## Grant Thesis

ArcPort V3 turns session-based API payments into an agent runtime:

- the operator funds a Circle wallet on Arc
- an agent receives a bounded USDC task budget
- the agent opens one session onchain
- the agent makes repeated paid API/model calls through signed vouchers
- ArcPort enforces session policy
- the agent closes once onchain
- unused budget is refunded
- Proof Mode exposes open tx, close tx, calls total, cumulative spend, refund, and Arcscan links

The browser remains the control plane. The runtime user is any external agent that can call HTTP APIs. Hermes is the first local adapter used for proof, not a hard dependency.

## What Is Ready

- Charge mode for one-off paid API calls.
- Session mode for repeated agent usage.
- Circle wallet identity support.
- Arc Testnet session contract.
- Gemini Inference as a paid API.
- LI.FI/Jumper funding path in Wallet.
- Explicit Arc fee policy for session close.
- Example Hermes skill adapter with CLI commands for wallet, session open, session call, session close.
- Session metadata for `agent_runtime`, `task`, `allowed_api_ids`, and `max_calls`.
- Canteen RPC support through `CANTEEN_ARC_RPC`.
- Live traction endpoint at `/api/traction`.

## What To Prove Before Applying

- One recorded external-agent run:
  - open a 10-call session
  - make 3 Gemini calls
  - close session
  - show refund and Arcscan links
- One proof artifact:
  - command transcript
  - open tx
  - close tx
  - calls total
  - cumulative spent
  - refund
- One traction artifact:
  - `/api/traction` response
  - `arc-canteen update product`
  - `arc-canteen update traction`
- One short developer quickstart:
  - create/fund wallet
  - run an agent adapter, for example Hermes with `arcport-hermes`
  - run a session lifecycle
- One reliability note:
  - idempotency keys for state-changing requests
  - per-session call lock
  - close tx fee policy

## Grant Milestones

### Milestone 1: Agent Runtime MVP

Deliver:

- external-agent end-to-end session demo
- proof artifacts
- policy enforcement for allowed APIs and max calls
- agent-facing CLI quickstart

Success metric:

- external agent completes open -> 3 calls -> close -> refund without browser clicks

### Milestone 2: SDK And Seller Middleware

Deliver:

- Node SDK with `openSession`, `callApi`, `closeSession`, `getProof`
- seller-side middleware for paid API endpoints
- structured proof export

Success metric:

- one API provider can add ArcPort payments without using the web UI

### Milestone 3: Webhooks And Proof Exports

Deliver:

- `session.opened`
- `session.call_authorized`
- `session.call_recorded`
- `session.closed`
- `session.refunded`
- JSON proof export for agent logs

Success metric:

- agent/operator can audit a session from machine-readable events

### Milestone 4: Unified Balance Funding

Deliver:

- research and prototype for Unified Balance as a funding source
- wallet UI funding abstraction
- documentation comparing LI.FI, faucet, wallet balance, Gateway balance, and Unified Balance

Success metric:

- operator can prepare an agent budget without manually reasoning about every funding layer

## Current Gap

The highest-priority missing proof is a real external-agent transcript. Hermes is the fastest first adapter, but the grant story should show ArcPort as an agent-agnostic payment runtime rather than a Hermes-specific integration.
