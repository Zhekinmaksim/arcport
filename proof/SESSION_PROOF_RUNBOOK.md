# Session Proof Runbook

Use this runner to generate a `50+` onchain transaction proof file before recording the demo.

## Default plan

- `17` session cycles
- `1` paid API call inside each cycle
- `3` onchain tx per cycle:
  - `approve`
  - `open`
  - `close`
- total: `51` onchain transactions

This is the shortest clean path on the current ArcPort architecture.

## Prerequisites

- local ArcPort dev server running on `http://127.0.0.1:3000`
- a funded Circle wallet identity
- `identity_key` for that wallet

## Run

```bash
cd /Users/zmaxx/Projects/ArcPort/arcport
node scripts/session-proof-runner.mjs --identity-key awi_...
```

## Useful variants

Use a different API:

```bash
node scripts/session-proof-runner.mjs \
  --identity-key awi_... \
  --api-id countries-1 \
  --params-json '{"country":"Germany"}'
```

Slow the run down slightly:

```bash
node scripts/session-proof-runner.mjs \
  --identity-key awi_... \
  --pause-ms 1200
```

Generate more or fewer cycles:

```bash
node scripts/session-proof-runner.mjs \
  --identity-key awi_... \
  --cycles 20 \
  --calls-per-cycle 1
```

## Output

The runner writes both timestamped and latest copies into `/Users/zmaxx/Projects/ArcPort/arcport/proof`:

- `session-proof-*.json`
- `session-proof-*.md`
- `session-proof-latest.json`
- `session-proof-latest.md`

Use the markdown file in the demo and submission as the flat proof list with Arcscan links.
