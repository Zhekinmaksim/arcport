# ArcPort Judge Quick Start

Read time: under 2 minutes
Demo time: about 60 seconds

ArcPort V2 introduces session-based API payments for repeated agent usage.

The browser is only the control plane in this demo. The runtime user is the agent.

Prerequisite: use a prepared Circle wallet funded with at least `0.01 USDC` on Arc Testnet.

## What to open

1. **Wallet**
2. **Playground**
3. **Proof Mode**

## Demo order

### 1. Open a session in `Wallet`

Click **Open 10-call session**.

What this proves:

- one onchain session is created with a fixed USDC budget
- repeated usage does not need a new onchain payment each time

### 2. Make 3 calls in `Playground`

Switch to **Session mode**, select **Gemini Inference**, and run **3 paid prompts**:

- one short bullet answer
- one one-line rewrite
- one short JSON response

What this proves:

- usage is authorized through signed offchain calls
- calls accrue against one session
- the product supports repeated machine usage, not just one-off billing
- the same payment model works against real model inference, not only data APIs

### 3. Close the session in `Wallet`

Click **Close session onchain**.

What this proves:

- settlement happens onchain once
- unused balance is refunded

### 4. Inspect `Proof Mode`

Show:

- `open tx`
- `close tx`
- `calls total`
- `cumulative spent`
- `refund`
- `channel status`

What this proves:

- what was onchain
- what was signed offchain
- that the full session lifecycle is auditable

## Optional add-on

Switch back to **Charge mode** and make one paid call.

What this proves:

- ArcPort still supports Circle Nanopayments for one-off usage
- the product has two payment modes for two different patterns
