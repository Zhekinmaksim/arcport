#!/usr/bin/env bash
set -euo pipefail

: "${ARCPORT_IDENTITY_KEY:?Set ARCPORT_IDENTITY_KEY=awi_... before running this demo}"

ARCPORT_URL="${ARCPORT_URL:-https://arcport.xyz}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLI="$SCRIPT_DIR/scripts/arcport.py"

echo "ArcPort Hermes smoke test"
echo "URL: $ARCPORT_URL"
echo

python "$CLI" wallet balance --key "$ARCPORT_IDENTITY_KEY"
python "$CLI" wallet fund-url --key "$ARCPORT_IDENTITY_KEY"
echo

TASK="ArcPort V3 Hermes runtime demo"
OPEN_JSON="$(python "$CLI" session open --calls 10 --task "$TASK" --key "$ARCPORT_IDENTITY_KEY")"
echo "$OPEN_JSON"
CHANNEL_ID="$(printf '%s\n' "$OPEN_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin)["channel_id"])')"

echo
python "$CLI" session call "$CHANNEL_ID" gemini \
  --prompt "Give one bullet on why agents need API budgets." \
  --task "$TASK" \
  --key "$ARCPORT_IDENTITY_KEY"

echo
python "$CLI" session call "$CHANNEL_ID" gemini \
  --prompt "Rewrite in one sentence: session mode lets agents make repeated paid API calls under one budget." \
  --task "$TASK" \
  --key "$ARCPORT_IDENTITY_KEY"

echo
python "$CLI" session call "$CHANNEL_ID" gemini \
  --prompt "Return JSON with keys charge_mode, session_mode, and refund." \
  --task "$TASK" \
  --key "$ARCPORT_IDENTITY_KEY"

echo
python "$CLI" session close "$CHANNEL_ID" --task "$TASK" --key "$ARCPORT_IDENTITY_KEY"
