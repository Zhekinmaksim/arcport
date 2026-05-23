# ArcPort

ArcPort is an API payment layer for agents on Arc.

ArcPort V2 introduces session-based API payments for repeated agent usage.

The marketplace also includes a paid `Gemini Inference` endpoint backed by Google AI Studio, so the same charge/session payment model can be shown against real model inference.

For the Agora Agents Hackathon, ArcPort V3 is adapted to **RFB 06 — Social Trading Intelligence** through a paid `Social Signal Intelligence` endpoint. A social trading agent can open one bounded USDC session, evaluate repeated trader signals, optionally call Gemini for a decision memo, close once onchain, and refund unused budget.

ArcPort is not a consumer app. The runtime user is the agent. The web app is an operator console for provisioning wallets, opening sessions, inspecting proof, and demonstrating the payment flow.

V3 moves ArcPort toward a grant-ready agent runtime: the Wallet view now points operators to LI.FI/Jumper funding for Arc Testnet, session close uses explicit Arc fee settings, and the machine-facing session APIs now carry agent policy metadata for any external agent runtime. Hermes is one adapter, not the product boundary.

Read the UI this way:

- **wallet balance** = operator funds on Arc
- **Gateway balance** = one-off charge-mode balance
- **session budget** = repeated-usage budget locked for one open session
- **refund** = unused session budget returned on close

For the [Agentic Economy on Arc hackathon](https://lablab.ai/ai-hackathons/nano-payments-arc), the repo is built around four things judges need to see:

- **charge mode** for one-off calls via Circle Nanopayments
- **session mode** for repeated usage
- **51 onchain transactions** already generated and documented
- **margin explanation** for why `$0.001` pricing breaks under traditional gas

Judge-facing docs:

- [JUDGE_QUICKSTART.md](docs/JUDGE_QUICKSTART.md)
- [GRANT_READINESS.md](docs/GRANT_READINESS.md)
- [AGORA_BUILD_NOTES.md](docs/AGORA_BUILD_NOTES.md)
- [hackathon-evidence/README.md](hackathon-evidence/README.md)
- [VIDEO_SCRIPT.md](submission/VIDEO_SCRIPT.md)
- [Hermes skill adapter](integrations/hermes-skill/SKILL.md)

## Charge vs Session

Charge mode is the simple path. Session mode is the differentiator.

- **charge mode**: one-off paid call through Circle Nanopayments
- **session mode**: repeated usage with one onchain open, signed calls offchain, one onchain close, and refund

ArcPort is reusable infrastructure. Any agent workflow that needs repeated API or model calls can use session mode instead of treating every request as a separate payment.

## Who ArcPort Is For

- **agent builders** who need a payment layer for API usage
- **agent operators** who manage wallet identity, session budgets, and proof
- **API providers** who want to monetize endpoints per call

Humans use ArcPort to provision and inspect. Agents use ArcPort to pay and execute.

## Product Surface

ArcPort has two layers:

- **web control plane** for wallet setup, session management, and proof
- **API runtime layer** for machine-to-API payments

That split matters. The hackathon demo runs through the web control plane, but the production payment user is the agent calling the API.

The next step after this submission is not a larger web app. It is a more agent-native runtime surface: stable machine-facing API contracts, SDKs, and client adapters so agents can open sessions, spend against them, and close them without depending on the browser flow.

V3 priorities:

- **LI.FI onboarding in Wallet**: route USDC to the operator wallet on Arc Testnet before opening sessions.
- **agent-first runtime demo**: an external agent opens a bounded session, makes paid calls, and closes with proof through ArcPort's session APIs. Hermes is the first local adapter.
- **explicit Arc fee handling**: close transactions use a predictable fee policy via `ARC_MAX_FEE_GWEI` and `ARC_PRIORITY_FEE_GWEI`.
- **Unified Balance later**: second-phase funding abstraction once the agent runtime is stable.
- **Agora traction proof**: `/api/traction` exposes live sessions, paid calls, USDC volume, and refunds for hackathon updates.

## Agora Agents Hackathon

ArcPort V3 should be submitted under **RFB 06 — Social Trading Intelligence**:

> ArcPort V3 is an agent-agnostic payment runtime for repeated paid API and model usage on Arc.

It is not a copy-trading terminal by itself. It is the payment/runtime layer a social trading agent uses to buy signal intelligence, enforce budgets, and produce verifiable receipts.

For the Canteen-hosted Arc RPC:

```bash
uv tool install git+https://github.com/the-canteen-dev/ARC-cli.git
arc-canteen login
arc-canteen rpc eth_chainId
arc-canteen rpc-url --export
```

Set either `CANTEEN_ARC_RPC` or `ARC_RPC` to the Canteen RPC URL. ArcPort reads `CANTEEN_ARC_RPC` first, then `ARC_RPC`, then falls back to the public Arc testnet RPC.

Live traction endpoint:

```text
https://arcport.xyz/api/traction
```

## How An Agent Integrates

The browser demo is only the control plane.

The machine-facing path is simple:

1. `POST /api/session-open`
2. `POST /api/session-call`
3. `POST /api/session-close`

That is the runtime surface the agent uses. The web app is there to provision wallets, inspect usage, and verify proof.

Example external-agent smoke test using Hermes:

```bash
export ARCPORT_URL=https://arcport.xyz
export ARCPORT_IDENTITY_KEY=awi_...
hermes chat -s arcport-hermes --toolsets "terminal,skills"
```

Ask the agent to open an ArcPort session, make three paid Gemini calls, close the session, and summarize the open tx, close tx, calls total, cumulative spend, and refund.

## Charge Mode

Use this when the agent needs one paid call.

Flow:

1. Request an API.
2. Receive a `402` challenge.
3. Sign `X-Payment` with a Circle wallet.
4. Retry the request.
5. ArcPort verifies payment and returns the response.

Why it exists:

- it matches the core Circle Nanopayments path the hackathon asks for
- it keeps one-off usage simple
- it makes `$0.001` calls viable without a separate onchain payment per request

Main files:

- [pay-and-call.js](api/pay-and-call.js)
- [x-payment.js](api/x-payment.js)
- [gateway.js](api/gateway.js)

## Session Mode

Use this when the agent expects repeated usage in a short window.

Flow:

1. Open a session onchain with a fixed USDC budget.
2. Authorize repeated signed calls offchain for each call.
3. Verify usage on every request.
4. Close the session onchain once.
5. Refund the unused balance.

Why it exists:

- repeated usage should not require a fresh onchain payment step every time
- the product needs a cleaner model than simple pay-per-call for high-frequency agent usage
- this is the main new primitive in ArcPort V2

Main files:

- [ArcStreamChannel.sol](contracts/ArcStreamChannel.sol)
- [session-open.js](api/session-open.js)
- [session-call.js](api/session-call.js)
- [session-close.js](api/session-close.js)

## 51 Onchain Transactions

ArcPort already generated **51 onchain transactions** from a reproducible session proof run.

Breakdown:

- `17` approve transactions
- `17` session open transactions
- `17` session close transactions

Artifacts:

- [session-proof-latest.md](proof/session-proof-latest.md)
- [session-proof-latest.json](proof/session-proof-latest.json)
- [SESSION_PROOF_RUNBOOK.md](proof/SESSION_PROOF_RUNBOOK.md)

Deployed session contract:

- [0x594a7E570d1f915f1e11d504d0e89de28680cC98](https://testnet.arcscan.app/address/0x594a7E570d1f915f1e11d504d0e89de28680cC98?tab=txs)

## Why `$0.001` Breaks With Traditional Gas

If every `$0.001` API call required its own onchain payment transaction, gas would be larger than the call price itself.

That breaks the model:

- the unit economics turn negative
- repeated usage becomes too expensive
- machine-to-API usage becomes operationally noisy

ArcPort handles this with two paths:

- **charge mode** removes per-call onchain execution from the buyer path
- **session mode** amortizes onchain cost across repeated usage

## Demo Path

The clean demo is:

1. Open **Wallet**
2. Open a session
3. Go to **Playground**
4. Make **3 paid calls** in session mode
5. Return to **Wallet**
6. Close the session
7. Open **Proof Mode**
8. Show `open tx`, `close tx`, `calls total`, `spent`, `refund`, and `status`

This is the path the video and judge docs follow.

For the clearest hackathon demo, use **Gemini Inference** in session mode:

1. open session
2. run 3 Gemini prompts:
   - one short bullet answer
   - one one-line rewrite
   - one short JSON response
3. close session
4. show refund and proof

## Local Run

Minimal local requirements:

- pull Vercel env into `.env.local`
- apply [supabase-v2-migration.sql](supabase-v2-migration.sql) to the existing database
- run the local dev server
- set `GEMINI_API_KEY` or `GOOGLE_AI_STUDIO_API_KEY`
- optionally set `GEMINI_MODEL` (default: `gemini-2.5-flash`)

The repo still contains older compatibility paths for development, but the hackathon story is only:

- **charge mode**
- **session mode**
- **51 tx proof**
- **margin explanation**

## License

MIT
