# ArcPort V3 For Agora Agents Hackathon

ArcPort V3 should be submitted under **RFB 06 — Social Trading Intelligence**.

It is not a copy-trading app by itself. It is the payment/runtime layer a social trading agent uses when it buys trader data, scores signals, enforces risk budgets, and produces verifiable receipts.

## One-Line Positioning

ArcPort V3 is a session-based payment runtime for social trading agents that need repeated paid signal intelligence on Arc.

## Selected RFB

**RFB 06 — Social Trading Intelligence**

Why this is the best fit:

- The RFB asks for agents that help users evaluate traders, strategies, and market signals.
- ArcPort already solves the payment problem for repeated paid API/model calls.
- V3 adds a concrete paid endpoint: `Social Signal Intelligence`.
- Session mode lets one agent evaluate multiple traders/signals under one bounded USDC budget.
- Proof Mode shows what the agent bought, how much it spent, what was refunded, and which policy was enforced.

Do not frame ArcPort as a finished trading terminal. Frame it as the paid intelligence and budget runtime for social trading agents.

## Agora Fit

Agora asks for agents that trade, invest, create, and interface with markets. RFB 06 asks for social trading intelligence. ArcPort provides the paid intelligence runtime for those agents:

1. An operator funds a Circle wallet with USDC on Arc.
2. An external agent receives a bounded task budget.
3. The agent opens one onchain session.
4. The agent makes repeated signed calls to `Social Signal Intelligence`, Gemini, or other paid APIs.
5. ArcPort enforces max calls and allowed APIs.
6. The agent closes once onchain.
7. Unused session budget is refunded.
8. Proof Mode shows open tx, close tx, calls total, cumulative spend, refund, and Arcscan links.

## Judging Criteria Mapping

### 30% Agentic Sophistication

The agent is the runtime user. The browser is only the control plane.

Show an external social trading agent using ArcPort through HTTP APIs:

- `POST /api/session-open`
- `POST /api/session-call`
- `POST /api/session-close`
- `GET /api/session-proof?channel_id=...`

The agent policy fields are:

- `agent_runtime`
- `task`
- `allowed_api_ids`
- `max_calls`

For the RFB 06 demo, set:

```json
{
  "agent_runtime": "External agent",
  "task": "RFB 06 social trading signal analysis",
  "allowed_api_ids": ["social-signal-1", "gemini-1"],
  "max_calls": 10
}
```

### 30% Traction

Use the live traction endpoint in the submission:

```text
https://arcport.xyz/api/traction
```

It reports:

- sessions
- closed sessions
- external-agent sessions
- one-off charge calls
- session calls
- total paid calls
- USDC volume
- refunded USDC

Use `arc-canteen update traction` during the hackathon to record progress in Canteen.

### 20% Circle Tool Usage

ArcPort uses:

- USDC for pricing and settlement
- Circle Wallets for operator wallet identity
- Circle Gateway / Nanopayments for charge mode
- Arc for session open and close settlement
- Arcscan for proof links
- optional LI.FI/Jumper funding path for getting USDC to the operator wallet

### 20% Innovation

Charge mode is the simple path. Session mode is the differentiator.

Session mode separates repeated usage from per-request settlement:

- open once onchain
- call repeatedly with signed vouchers offchain
- close once onchain
- refund unused balance

That is the core answer to why repeated `$0.001` agent calls need a session primitive.

## Canteen ARC CLI

Install the Canteen CLI:

```bash
uv tool install git+https://github.com/the-canteen-dev/ARC-cli.git
arc-canteen login
arc-canteen rpc eth_chainId
```

Export the Canteen-hosted Arc RPC:

```bash
arc-canteen rpc-url --export
```

Then set one of these env vars for ArcPort:

```bash
CANTEEN_ARC_RPC=https://rpc.testnet.arc-node.thecanteenapp.com/v1/<key>
ARC_RPC=https://rpc.testnet.arc-node.thecanteenapp.com/v1/<key>
```

ArcPort reads `CANTEEN_ARC_RPC` first, then `ARC_RPC`, then falls back to the public Arc testnet RPC.

Sync Arc/Circle context for coding agents:

```bash
arc-canteen context sync
arc-canteen context
```

## Product Updates

Use this style for `arc-canteen update product`:

```text
ArcPort V3 now exposes agent policy in the session runtime: agent_runtime, task, allowed_api_ids, and max_calls.

The browser remains the control plane. External agents can open a bounded session, make repeated paid API/model calls, close once onchain, refund unused budget, and load proof by channel_id.
```

## Traction Updates

Use this style for `arc-canteen update traction`:

```text
ArcPort traction update:
- sessions: <from /api/traction>
- total paid calls: <from /api/traction>
- USDC volume: <from /api/traction>
- refunded USDC: <from /api/traction>
- external-agent run: <yes/no>

Proof endpoint: https://arcport.xyz/api/traction
```

## Demo Scenario

Use an RFB 06 social trading intelligence scenario:

```text
An external social trading agent receives a 10-call USDC budget.
It opens one ArcPort session on Arc.
It makes repeated paid Social Signal Intelligence calls to evaluate trader signals.
It optionally calls Gemini to summarize the final decision memo.
ArcPort enforces the call limit and records cumulative spend.
The agent closes the session.
Unused budget is refunded.
The operator loads the channel ID in Proof Mode and sees Arcscan links plus agent policy.
```

Hermes can be the first local adapter for this demo, but the product story should remain agent-agnostic.

## Submission Language

Use this phrasing:

```text
ArcPort V3 is a session-based payment runtime for social trading agents that need repeated paid signal intelligence on Arc.

Social trading agents need to evaluate many traders and signals without giving the agent unlimited wallet access. ArcPort gives them a session primitive: open once onchain, make repeated paid signal/model calls offchain, close once onchain, and refund unused USDC.
```
