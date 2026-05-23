# Hermes Recording Plan For ArcPort

This is the honest demo plan for the Hermes forum.

Do not claim "Hermes is built into ArcPort UI." It is not. The integration is a Hermes skill that lets Hermes call ArcPort as an agent runtime.

## What The Video Must Prove

The screen must show Hermes itself doing the work:

1. Hermes loads the `arcport-hermes` skill.
2. Hermes uses the skill's local CLI.
3. Hermes opens an ArcPort session.
4. Hermes makes repeated paid Gemini/API calls.
5. Hermes closes the session.
6. Output shows proof: open tx, close tx, calls total, cumulative spent, refund, Arcscan.

## Setup

Install Hermes Agent first.

Official docs:

- https://hermes-agent.nousresearch.com/docs/user-guide/cli
- https://hermes-agent.nousresearch.com/docs/skills/

Copy the skill:

```bash
mkdir -p ~/.hermes/skills/arcport-hermes
cp -R skill/SKILL.md skill/scripts ~/.hermes/skills/arcport-hermes/
```

Set the identity key:

```bash
export ARCPORT_URL=https://arcport.xyz
export ARCPORT_IDENTITY_KEY=awi_...
```

Session mode needs a funded Circle wallet on Arc Testnet. If needed:

```bash
python ~/.hermes/skills/arcport-hermes/scripts/arcport.py wallet create-circle
python ~/.hermes/skills/arcport-hermes/scripts/arcport.py wallet balance --key awi_...
python ~/.hermes/skills/arcport-hermes/scripts/arcport.py wallet fund-url --key awi_...
```

Fund the returned address through the printed LI.FI/Jumper URL. Faucet fallback:

```text
https://faucet.circle.com
```

## Recording Shot List

### 1. Skill Loaded In Hermes

Show terminal:

```bash
hermes --tui -s arcport-hermes
```

Or single-query mode:

```bash
hermes chat -s arcport-hermes --toolsets "terminal,skills"
```

Caption:

```text
Hermes loads ArcPort as a payment skill.
```

### 2. User Prompt Inside Hermes

Paste this prompt into Hermes:

```text
Use the ArcPort Hermes skill. Open a 10-call session, make 3 paid Gemini calls, close the session, and summarize the payment proof.

Use these prompts:
1. Give one bullet on why agents need API budgets.
2. Rewrite in one sentence: session mode lets agents make repeated paid API calls under one budget.
3. Return JSON with keys charge_mode, session_mode, and refund.
```

Make sure Hermes runs the commands itself through the terminal tool. The goal is to show an external agent using ArcPort, not ArcPort launching Hermes internally.

Caption:

```text
The user asks Hermes for repeated paid API usage, not a browser walkthrough.
```

### 3. Hermes Opens Session

Expected tool command:

```bash
python scripts/arcport.py session open --calls 10 --task "ArcPort V3 Hermes runtime demo"
```

Show output fields:

```text
Channel
Open tx
Arcscan
```

Caption:

```text
One onchain open creates the session budget.
```

### 4. Hermes Makes 3 Paid Calls

Expected tool commands:

```bash
python scripts/arcport.py session call <channel_id> gemini --prompt "Give one bullet on why agents need API budgets."
python scripts/arcport.py session call <channel_id> gemini --prompt "Rewrite in one sentence: session mode lets agents make repeated paid API calls under one budget."
python scripts/arcport.py session call <channel_id> gemini --prompt "Return JSON with keys charge_mode, session_mode, and refund."
```

Show output fields:

```text
Calls total
Cumulative spent
Remaining
```

Caption:

```text
Repeated calls are signed offchain against the same session.
```

### 5. Hermes Closes Session

Expected tool command:

```bash
python scripts/arcport.py session close <channel_id>
```

Show output fields:

```text
Close tx
Calls total
Cumulative spent
Refund
Arcscan
```

Caption:

```text
One onchain close settles spend and refunds unused balance.
```

### 6. Final Hermes Summary

Hermes should summarize:

```text
ArcPort V2 introduces session-based API payments for repeated agent usage.

open tx: ...
close tx: ...
calls total: 3
cumulative spent: 0.003 USDC
refund: 0.007 USDC
```

Caption:

```text
Hermes used ArcPort as an agent payment layer.
```

## Forum Post Angle

Use this wording:

```text
I made a Hermes skill for ArcPort.

Hermes can now use ArcPort as a paid API/payment layer on Arc:
one-off charge mode for a single API call, or session mode for repeated agent usage.

The demo shows Hermes opening one session, making 3 paid Gemini calls, closing once, refunding unused balance, and returning Arcscan proof.
```

Avoid this wording:

```text
Hermes is built into the ArcPort UI.
```

That is not accurate.
