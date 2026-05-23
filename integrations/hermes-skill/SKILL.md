---
name: arcport-hermes
description: |
  Use ArcPort from Hermes as a paid API/payment skill on Arc. Use when Hermes
  needs one-off paid API calls through charge mode, repeated Social Signal
  Intelligence or Gemini/API calls through session mode, or an auditable Arc Testnet payment lifecycle with open
  tx, close tx, calls total, cumulative spend, refund, and Arcscan proof.
version: 2.0.0
author: Zhekinmaksim
license: MIT
homepage: https://github.com/Zhekinmaksim/arcport
platforms: [macos, linux]
metadata:
  hermes:
    tags: [arc, circle, usdc, payments, agents, social-trading, api-monetization, gemini]
    category: blockchain
    required_environment_variables:
      - name: ARCPORT_URL
        prompt: ArcPort deployment URL
        help: Defaults to https://arcport.xyz
        required_for: optional override
      - name: ARCPORT_IDENTITY_KEY
        prompt: ArcPort wallet identity key
        help: Required for Circle wallet session mode. Create one with `python scripts/arcport.py wallet create-circle`.
        required_for: session mode
---

# ArcPort Hermes Skill

ArcPort V2 introduces session-based API payments for repeated agent usage.

This skill lets Hermes use ArcPort as a machine-facing payment layer on Arc:

- **charge mode** for one-off paid API calls
- **session mode** for repeated paid API/model calls under one budget
- **Proof Mode** style evidence: open tx, close tx, calls total, cumulative spent, refund, channel status

Charge mode is the simple path. Session mode is the differentiator.

## Install

Copy this folder into the Hermes skills directory:

```bash
~/.hermes/skills/arcport-hermes/
  SKILL.md
  scripts/arcport.py
```

Optional environment:

```bash
export ARCPORT_URL=https://arcport.xyz
export ARCPORT_IDENTITY_KEY=awi_...
```

Use `ARCPORT_IDENTITY_KEY` for V2 Circle wallet/session mode. `ARCPORT_AGENT_KEY` is still accepted for legacy charge-mode calls.

After installation, start Hermes with the skill loaded:

```bash
hermes chat -s arcport-hermes --toolsets "terminal,skills"
```

Or in the interactive Hermes TUI:

```bash
hermes --tui -s arcport-hermes
```

## What Hermes Can Do

Hermes can call ArcPort in two ways.

**Charge mode**

Use when Hermes needs one paid response:

```bash
python scripts/arcport.py call gemini \
  --prompt "Return one sentence explaining session-based API payments." \
  --key awi_...
```

For Agora RFB 06:

```bash
python scripts/arcport.py call social-signal \
  --leader "HL Whale Alpha" \
  --asset BTC \
  --direction long \
  --confidence 0.74 \
  --win-rate 0.62 \
  --drawdown-pct 8 \
  --key awi_...
```

**Session mode**

Use when Hermes expects repeated usage:

```bash
python scripts/arcport.py session open \
  --calls 10 \
  --task "RFB 06 social trading signal analysis" \
  --allowed-api social-signal \
  --allowed-api gemini \
  --key awi_...

python scripts/arcport.py session call <channel_id> social-signal \
  --leader "HL Whale Alpha" \
  --asset BTC \
  --direction long \
  --confidence 0.74 \
  --win-rate 0.62 \
  --drawdown-pct 8 \
  --key awi_...

python scripts/arcport.py session call <channel_id> social-signal \
  --leader "Momentum Desk" \
  --asset SOL \
  --direction long \
  --confidence 0.58 \
  --win-rate 0.51 \
  --drawdown-pct 18 \
  --key awi_...

python scripts/arcport.py session call <channel_id> gemini \
  --prompt "Summarize the social trading decision in one short memo." \
  --key awi_...

python scripts/arcport.py session close <channel_id> --key awi_...
```

For V3 grant demos, Hermes should run these commands itself from the skill directory. ArcPort should not spawn Hermes internally. The proof is that an external agent uses ArcPort through the machine-facing session APIs.

What this proves:

- one onchain open
- repeated signed calls offchain
- one onchain close
- unused session budget refunded
- Arcscan proof available for the lifecycle

## Wallet Setup

Session mode requires a Circle Dev-Controlled wallet identity with USDC on Arc Testnet.

```bash
python scripts/arcport.py wallet create-circle
python scripts/arcport.py wallet balance --key awi_...
```

Fund the returned Arc address on Arc Testnet:

```text
python scripts/arcport.py wallet fund-url --key awi_...
```

The command prints a LI.FI/Jumper route to Arc Testnet USDC for this wallet. Faucet fallback: `https://faucet.circle.com`.

Important balance model:

- wallet balance = operator funds on Arc
- Gateway balance = one-off charge-mode balance
- session budget = funds locked for one open session
- refund = unused session funds returned on close

## Available APIs

| Command | Use | Mode |
| --- | --- | --- |
| `social-signal` | RFB 06 social trading signal intelligence | charge + session |
| `gemini` | Google AI Studio / Gemini inference | charge + session |
| `weather` | Weather by city | charge + session |
| `fx` | FX rates | charge + session |
| `crypto` | BTC, ETH, USDC prices | charge + session |
| `geoip` | IP geolocation | charge + session |
| `country` | Country facts | charge + session |
| `joke` | Random joke | charge + session |

Each call is priced at `$0.001 USDC`.

## Agent Procedure

When Hermes needs a paid API response:

1. If the task is one-off, use `call <api>`.
2. If the task needs repeated calls, use `session open`, then `session call`, then `session close`.
3. Keep the `channel_id` from `session open`.
4. Do not open a second session if one session is already open for the same workflow.
5. Show Arcscan links from the open and close responses when the user asks for proof.

For a grant-facing V3 demo, use this exact task shape:

```text
Use ArcPort session mode as the runtime agent.
Open a 10-call session.
Make 3 paid Social Signal Intelligence calls.
Optionally make 1 Gemini call for a decision memo.
Close the session.
Summarize open tx, close tx, calls total, cumulative spent, refund, and Arcscan links.
```

## Safety Rules

- Do not retry state-changing session requests with a new idempotency key if the previous request may still be processing.
- If a session call returns `Another session call is already in progress`, wait and retry later.
- If close returns an Arc RPC txpool error, wait a few seconds and close again with the same workflow context.
- If wallet balance is low, explain that Gateway balance cannot open sessions.

## Community Showcase Summary

ArcPort as a Hermes skill turns Hermes into a paid API consumer on Arc.

The interesting part is session mode. Hermes can open one funded session, make repeated signed Social Signal Intelligence or Gemini/API calls, then close once and refund unused balance. That is closer to real agent usage than asking the user to approve every micro-call one by one.

Live app: https://arcport.xyz

## What To Show In A Hermes Demo

For a real Hermes screenshot or video, show the Hermes terminal/TUI doing the work, not only ArcPort UI.

Minimum proof sequence:

1. Hermes starts with `arcport-hermes` loaded.
2. User asks Hermes to use ArcPort session mode.
3. Hermes runs `python scripts/arcport.py session open --calls 10`.
4. Hermes runs 3 `session call` commands against `social-signal`.
5. Hermes runs `session close`.
6. Output shows `Channel`, `Open tx`, `Calls total`, `Cumulative spent`, `Refund`, and `Arcscan`.
