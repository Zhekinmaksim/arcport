# ArcPort Submission Copy

Use this file as the source of truth for the lablab.ai submission form.

Canonical sentence:

ArcPort V2 introduces session-based API payments for repeated agent usage.

## Submission Title

ArcPort

## Short Description

ArcPort is an API payment layer for agents on Arc: charge mode for one-off Circle Nanopayments and session mode for repeated Gemini/API calls with one onchain open, signed offchain usage, one close, refund, and proof.

## Long Description

ArcPort is an API payment layer for agents on Arc.

ArcPort V2 introduces session-based API payments for repeated agent usage.

The product has two payment modes. Charge mode is the simple path: one paid API call through Circle Nanopayments. Session mode is the differentiator: open one session onchain, let the agent make repeated signed API calls offchain, close once onchain, and refund the unused balance.

This matters because $0.001 API pricing breaks if every request needs its own onchain transaction. Gas and settlement overhead can become larger than the call price. ArcPort keeps one-off calls simple with charge mode and makes repeated agent usage practical with session mode.

The browser demo is not the final runtime user. It is a control plane for operators: fund the wallet, open a session, run the demo, close the session, and inspect proof. The runtime user is the agent calling APIs through /api/session-open, /api/session-call, and /api/session-close.

The demo uses Gemini Inference as a paid API in the marketplace. A judge can open a 10-call session, run 3 Gemini prompts, close the session, see the refund, and verify the lifecycle in Proof Mode.

Proof Mode shows the full payment lifecycle: open tx, close tx, calls total, cumulative spent, refund, and channel status. The repo also includes a reproducible evidence run with 51 onchain transactions: 17 approve, 17 open, and 17 close transactions on Arc Testnet.

ArcPort is useful as repeated paid API usage for agents, a practical control plane for operators, and a verifiable payment lifecycle for reviewers.

## Participation Mode

Online

## Recommended Event Tracks

Select these if the form allows multiple tracks:

- Per-API Monetization Engine
- Usage-Based Compute Billing
- Google

If only one track is allowed, choose:

- Usage-Based Compute Billing

## Recommended Categories

Use the closest available options in the form:

- AI Agents
- Payments
- Developer Tools
- Web3

## Technologies Used

- Arc Testnet
- USDC
- Circle Nanopayments
- Circle Dev-Controlled Wallets
- Circle Gateway
- Google AI Studio / Gemini API
- x402 / X-Payment
- Solidity session contract
- Node.js / Vercel Functions
- Supabase

## Did You Use Circle Products?

Yes.

## Circle Developer Console Account Email

Use the email connected to the Circle Developer Console account used for the demo wallets.

## Circle Product Feedback

Products used:

ArcPort used Arc Testnet, USDC, Circle Dev-Controlled Wallets, Circle Gateway, and Circle Nanopayments. Charge mode uses the Circle Nanopayments pattern for one-off paid API calls. Session mode is built beside that path for repeated agent usage where a fixed USDC budget is opened once, spent through signed calls, and settled once.

Use case:

The project is built around agent API usage. Agents should not need subscriptions or manual approval for every small request. They need a way to pay per action, stay inside a budget, and leave an auditable trail. Circle's stack fits this because payments are USDC-native and can be tied to API access rather than human checkout flows.

What worked well:

Dev-Controlled Wallets made it possible to create an operator wallet and run the demo without asking a judge to connect a personal wallet. Circle Gateway worked well for the one-off charge-mode balance. The Nanopayments model maps cleanly to API calls, especially when the price is small enough to make subscriptions feel unnecessary. Arc Testnet confirmation speed was good enough for a live demo when the network was not congested.

Challenges:

The biggest product gap for repeated usage is that one paid API call is not enough for agents. Real agents make bursts of calls. That is why ArcPort adds session mode. During development, the main friction was making wallet balance, Gateway balance, session budget, and refund easy to explain in the UI. Another issue was operational reliability around testnet RPC congestion and transaction-pool errors. For demos, state-changing retries also need idempotency keys; otherwise retrying a session open, call, or close can duplicate a mutation.

Recommendations:

Circle's developer experience would be stronger with first-class examples for repeated agent usage, not only single paid requests. Helpful additions would be official idempotency guidance for payment API mutations, clearer examples for Gateway balance versus wallet balance, better testnet congestion messaging, and a reference pattern for session-style budgets where many signed calls settle under one payment lifecycle.

## Submission Video Post On X

Post the video from the project account or personal account. In the same post, tag:

- @buildoncircle
- @arc
- @lablabai

Suggested post:

ArcPort V2 for the Agentic Economy on Arc hackathon.

ArcPort V2 introduces session-based API payments for repeated agent usage.

Most demos stop at one paid API call. ArcPort keeps that path, then adds session mode:

1. open one session onchain
2. run repeated signed API calls offchain
3. close once onchain
4. refund unused balance
5. show proof

The demo uses Gemini Inference as a paid API:

- open a 10-call session
- run 3 paid Gemini prompts
- close the session
- verify open tx, close tx, calls total, cumulative spent, refund, and channel status

Charge mode is the simple path. Session mode is the differentiator.

Evidence already generated:

- 51 onchain tx
- 17 approve
- 17 open
- 17 close
- Arcscan proof included

ArcPort is not a consumer marketplace first. The web app is the operator control plane. The runtime user is the agent.

Built with Arc Testnet, USDC, Circle Nanopayments, Circle Wallets, Circle Gateway, Google AI Studio/Gemini, x402, Solidity, Vercel, and Supabase.

@buildoncircle @arc @lablabai

## Video Upload

Use the final demo video with English subtitles.

## Slide Presentation PDF

Use:

submission/ArcPort-slides.pdf

## Cover Image

Use a 16:9 frame from the deck or video where the viewer can read:

- ArcPort V2
- Charge mode
- Session mode
- 51 tx proof
- open -> calls -> close -> refund

## Core Demo Path

1. Prepared Circle wallet is funded on Arc Testnet.
2. Open Wallet.
3. Open a 10-call session.
4. Open Playground.
5. Select Session mode and Gemini Inference.
6. Run 3 paid prompts.
7. Return to Wallet.
8. Close the session.
9. Open Proof Mode.
10. Show open tx, close tx, calls total, cumulative spent, refund, and channel status.

## Agora Agents Hackathon Copy

Use this version for Canteen / Agora forms.

### Short Description

ArcPort V3 is a session-based payment runtime for RFB 06 social trading agents. Agents get a bounded USDC budget, evaluate repeated trader signals through paid API/model calls, close once onchain, refund unused balance, and produce verifiable proof.

### Long Description

ArcPort V3 is payment infrastructure for **RFB 06 — Social Trading Intelligence** agents on Arc.

It is not a copy-trading terminal by itself. It is the runtime payment layer a social trading agent needs when it buys trader data, scores signals, calls models, executes tasks under strict budgets, and leaves auditable receipts.

The core primitive is session mode. An operator funds a Circle wallet with USDC on Arc. An external social trading agent receives a bounded task budget with policy fields such as runtime, task, allowed APIs, and max calls. The agent opens one session onchain, makes repeated paid Social Signal Intelligence or Gemini calls through signed offchain vouchers, then closes once onchain. ArcPort records cumulative spend and refunds unused USDC.

This matters for Agora because social trading agents need to evaluate many traders and signals quickly without unlimited wallet access. If every `$0.001` signal or model call required its own settlement path, the economics and UX break. ArcPort keeps the payment lifecycle verifiable while allowing repeated agent usage to happen at machine speed.

The browser is the control plane for operators and judges. The runtime user is the external agent calling `/api/session-open`, `/api/session-call`, `/api/session-close`, and `/api/session-proof`. Proof Mode shows open tx, close tx, calls total, cumulative spend, refund, channel status, and Arcscan links.

ArcPort uses USDC, Circle Wallets, Gateway/Nanopayments, Arc settlement, a Solidity session contract, Social Signal Intelligence as an RFB 06 paid endpoint, Google AI Studio/Gemini as a paid model endpoint, Vercel Functions, and Supabase.

### Agora Positioning

ArcPort V3 is submitted under RFB 06 — Social Trading Intelligence.

Social trading agents need paid signal intelligence and paid inference. ArcPort gives them bounded budgets, policy enforcement, session accounting, refund logic, and proof.

### Agora Traction Source

Use:

```text
https://arcport.xyz/api/traction
```

This endpoint reports sessions, paid calls, USDC volume, refunds, and external-agent session count for hackathon updates.

## Differentiation

Do not frame ArcPort as just another marketplace.

Use this framing:

ArcPort is a payment layer for repeated paid API usage by agents. The browser is a control plane. The machine-facing runtime is the API session flow.

Use this comparison:

- Charge mode: one-off calls
- Session mode: repeated usage
- Proof Mode: verifiable lifecycle
- 51 tx evidence: real activity on Arc Testnet

## Links To Include Where Useful

- Live app: https://arcport.xyz
- GitHub: https://github.com/Zhekinmaksim/arcport
- Session contract: https://testnet.arcscan.app/address/0x594a7E570d1f915f1e11d504d0e89de28680cC98?tab=txs
- Evidence file: proof/session-proof-latest.md
- Slide deck: submission/ArcPort-slides.pdf
