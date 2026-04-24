# ArcPort Submission Copy

Use these blocks directly in the submission form.

## Canonical Positioning

ArcPort V2 introduces session-based API payments for repeated agent usage.

Use this exact sentence in the submission, README, video voiceover, and public posts.

## Project Name

ArcPort

## One-Line Summary

ArcPort is an API payment layer for agents on Arc with two payment modes: charge mode for one-off calls via Circle Nanopayments, and session mode for repeated usage with one onchain open and one onchain close. The web app is an operator control plane; the runtime user is the agent.

## Short Description

ArcPort lets agents pay `$0.001 USDC` per API call on Arc. Charge mode handles one-off calls through Circle Nanopayments. V2 adds session mode for repeated usage: open once onchain, make repeated signed calls offchain, close once, and refund the unused balance. The web app is a control plane for setup, proof, and demo.

## Long Description

ArcPort is an API payment layer for agents on Arc.

The product has two payment modes.

The runtime user is the agent. The web app is an operator console for wallet setup, session management, and proof.

Charge mode is for one-off usage. The agent requests an API, receives a `402` payment challenge, signs `X-Payment`, and gets the response after successful verification through Circle Nanopayments.

Session mode is for repeated usage. The agent opens a session onchain with a fixed USDC budget, makes repeated signed calls offchain, and closes the session onchain once. The platform takes the cumulative spend and refunds the unused balance.

This makes ArcPort useful as a practical operator surface, not just abstract payment infrastructure. Agents can run repeated paid API usage under one budget, while operators can open sessions, inspect usage, and verify the full lifecycle through open transaction, close transaction, spend, refund, and proof.

This matters because `$0.001` API pricing breaks if every request needs its own onchain payment transaction. ArcPort handles one-off calls with charge mode and repeated usage with session mode. The marketplace also includes a paid Gemini Inference endpoint backed by Google AI Studio, so the same payment model can be shown against real model inference.

## Problem

Subscriptions and prepaid plans are built for humans. Agents need to pay for usage as it happens. One-off calls can work through a nanopayment flow, but repeated usage needs a cleaner model than a fresh onchain step on every request. It also needs an operator surface for provisioning and auditability without turning the product into a human-only app.

## Solution

ArcPort splits the product into two paths:

- **charge mode** for one-off API calls through Circle Nanopayments
- **session mode** for repeated usage through one onchain open, many signed offchain calls, and one onchain close with refund

It also splits the product surface into two layers:

- **web control plane** for provisioning wallets, opening sessions, and inspecting proof
- **API runtime layer** for the actual agent-to-API payment flow

In practice, an agent integrates through `/api/session-open`, `/api/session-call`, and `/api/session-close`. The browser is only the operator surface shown in the demo.

After the hackathon, the natural next step is not a larger browser app. It is a more agent-native runtime surface with stable machine-facing API contracts and SDKs, while the web UI remains a control plane for setup and auditability.

## Why Arc

Arc makes this pricing model viable because the product is priced in USDC and the system does not have to push a separate onchain payment for every `$0.001` call.

## Why Circle

Charge mode uses Circle Nanopayments for one-off paid API calls. Session mode is built alongside that path for repeated usage, where the agent opens a budget once and spends against it across multiple calls.

## Who Uses ArcPort

- **agent builders** integrate the runtime payment layer into their agents
- **agent operators** use the web control plane to provision wallets and inspect proof
- **API providers** register endpoints and monetize usage per call

## What The Demo Shows

The demo shows one clean session lifecycle around Gemini Inference:

1. open session
2. run 3 paid prompts
3. close session
4. refund unused balance
5. inspect proof

Proof Mode then shows:

- `open tx`
- `close tx`
- `calls total`
- `cumulative spent`
- `refund`
- `channel status`

## Proof Of Activity

ArcPort already generated proof for **51 onchain transactions** through a reproducible session proof run:

- `17` approve transactions
- `17` session open transactions
- `17` session close transactions

Artifacts:

- [session-proof-latest.md](../proof/session-proof-latest.md)
- [session-proof-latest.json](../proof/session-proof-latest.json)

## Why This Fits The Hackathon

ArcPort covers the main judging points directly:

- **Arc**
- **USDC**
- **Circle Nanopayments**
- **real per-action pricing**
- **50+ onchain transactions**
- **clear explanation of why `$0.001` pricing breaks under traditional gas**

## What Is New Here

Charge-per-call is the obvious starting point.

The new part in ArcPort V2 is session mode: repeated API usage under one session budget, with one onchain open, many signed calls, one onchain close, and refund of the unused balance.

## If The Form Asks For Differentiation

Most nanopayment demos stop at one paid request.

ArcPort keeps that one-off path, but adds session mode for repeated usage. That gives the product a second payment model instead of treating every call as an isolated payment event.

The product is also not framed as a consumer app. The web UI is a control plane. The actual runtime user is the agent.

## If The Form Asks For Technical Stack

- Arc Testnet
- USDC
- Circle Dev-Controlled Wallets
- Circle Nanopayments
- Google AI Studio / Gemini API
- x402 / `X-Payment`
- Solidity session contract
- Node.js / Vercel Functions
- Supabase

## If The Form Asks For The Core Demo Line

ArcPort V2 introduces session-based API payments for repeated agent usage.
