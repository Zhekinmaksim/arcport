#!/usr/bin/env python3
"""ArcPort CLI for the Hermes skill.

ArcPort V2 introduces session-based API payments for repeated agent usage.

Charge mode: one paid API call.
Session mode: one onchain open, repeated signed calls offchain, one onchain close,
and refund of unused session budget.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import uuid
import urllib.error
import urllib.request


DEFAULT_URL = "https://arcport.xyz"
ARC_CHAIN_ID = "5042002"
ARC_USDC_ADDRESS = "0x3600000000000000000000000000000000000000"

API_IDS = {
    "gemini": "gemini-1",
    "weather": "weather-1",
    "fx": "fx-1",
    "crypto": "crypto-1",
    "geoip": "geo-1",
    "country": "countries-1",
    "joke": "joke-1",
}


def _get_base_url() -> str:
    return os.environ.get("ARCPORT_URL", DEFAULT_URL).rstrip("/")


def _get_key(key_arg: str | None) -> str:
    key = key_arg or os.environ.get("ARCPORT_IDENTITY_KEY") or os.environ.get("ARCPORT_AGENT_KEY", "")
    if not key:
        print("ERROR: No ArcPort key. Run: python scripts/arcport.py wallet create-circle", file=sys.stderr)
        sys.exit(1)
    return key


def _short_id(prefix: str) -> str:
    # Circle refId is capped at 100 chars. Keep idempotency keys short.
    return f"{prefix}-{uuid.uuid4().hex}"


def _funding_url(address: str | None = None) -> str:
    url = f"https://jumper.exchange/?toChain={ARC_CHAIN_ID}&toToken={ARC_USDC_ADDRESS}&integrator=arcport"
    if address:
        url += f"&toAddress={address}"
    return url


def _request(
    method: str,
    path: str,
    body: dict | None = None,
    key: str | None = None,
    idempotency_key: str | None = None,
) -> dict:
    url = _get_base_url() + path
    data = json.dumps(body).encode() if body else None
    headers = {"Content-Type": "application/json"}
    if key:
        headers["Authorization"] = f"Bearer {key}"
    if idempotency_key:
        headers["X-Idempotency-Key"] = idempotency_key

    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        body_text = exc.read().decode()
        try:
            err = json.loads(body_text)
        except Exception:
            err = {"error": body_text}
        print(f"ERROR {exc.code}: {json.dumps(err, indent=2)}", file=sys.stderr)
        sys.exit(1)
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)


def cmd_wallet_create(_args) -> None:
    result = _request("POST", "/api/wallet", {"action": "create"})
    print(json.dumps(result, indent=2))
    print()
    print(f"Identity key: {result.get('identity_key', '')}")
    print(f"Agent key:    {result.get('agent_key', '')}")
    print(f"Arc address: {result.get('arc_address', '')}")
    print()
    print(f"Next: Fund your address through LI.FI: {_funding_url(result.get('arc_address', ''))}")
    print("Fallback: https://faucet.circle.com (Arc Testnet)")
    print(f"Then set: export ARCPORT_IDENTITY_KEY={result.get('identity_key', '')}")


def cmd_wallet_create_circle(_args) -> None:
    result = _request("POST", "/api/wallet", {"action": "create_circle"})
    print(json.dumps(result, indent=2))
    print()
    print(f"Identity key: {result.get('identity_key', '')}")
    print(f"Wallet type:  {result.get('wallet_type', '')}")
    print(f"Arc address:  {result.get('arc_address', '')}")
    print()
    print(f"Next: Fund the Arc address through LI.FI: {_funding_url(result.get('arc_address', ''))}")
    print("Fallback: https://faucet.circle.com (Arc Testnet)")
    print(f"Then set: export ARCPORT_IDENTITY_KEY={result.get('identity_key', '')}")


def cmd_wallet_balance(args) -> None:
    key = _get_key(args.key)
    result = _request("GET", "/api/wallet", key=key)
    print(json.dumps(result, indent=2))
    balance = result.get("balance_usdc") or result.get("balance") or "?"
    address = result.get("arc_address") or result.get("address") or "?"
    print()
    print(f"Balance: {balance} USDC")
    print(f"Address: {address}")
    print(f"Fund via LI.FI: {_funding_url(address if address != '?' else None)}")


def cmd_wallet_fund_url(args) -> None:
    key = _get_key(args.key)
    result = _request("GET", "/api/wallet", key=key)
    address = result.get("arc_address") or result.get("address") or ""
    print(_funding_url(address))


def cmd_call(args) -> None:
    api_name = args.api_name.lower()
    if api_name not in API_IDS:
        print(f"ERROR: Unknown API '{api_name}'. Available: {', '.join(API_IDS)}", file=sys.stderr)
        sys.exit(1)

    key = _get_key(args.key)
    api_id = API_IDS[api_name]

    params: dict = {}
    if api_name == "gemini":
        if not args.prompt:
            print("ERROR: --prompt is required for gemini", file=sys.stderr)
            sys.exit(1)
        params["prompt"] = args.prompt
        if args.system:
            params["system"] = args.system
        if args.temperature is not None:
            params["temperature"] = args.temperature
        if args.max_output_tokens is not None:
            params["max_output_tokens"] = args.max_output_tokens
    elif api_name == "weather" and args.city:
        params["city"] = args.city
    elif api_name == "fx" and args.base:
        params["base"] = args.base
    elif api_name == "geoip" and args.ip:
        params["ip"] = args.ip
    elif api_name == "country" and args.name:
        params["country"] = args.name

    result = _request("POST", "/api/pay-and-call", {"api_id": api_id, "params": params}, key=key)
    print(json.dumps(result, indent=2))

    payment = result.get("payment", {})
    if payment:
        print()
        print(f"Paid: {payment.get('amount')} {payment.get('currency')}")
        print(f"TX:   {payment.get('tx_hash')}")
        print(f"Explorer: {payment.get('explorer')}")
        print(f"Finality: {payment.get('finality_ms')}ms")


def cmd_session_open(args) -> None:
    key = _get_key(args.key)
    deposit = args.deposit or round(args.calls * 0.001, 6)
    body = {
        "deposit_usdc": deposit,
        "expected_calls": args.calls,
        "max_calls": args.calls,
        "allowed_api_ids": [API_IDS[api] for api in args.allowed_api],
        "agent_runtime": "hermes",
        "task": args.task,
    }
    result = _request(
        "POST",
        "/api/session-open",
        body,
        key=key,
        idempotency_key=_short_id("hso"),
    )
    print(json.dumps(result, indent=2))
    print()
    print(f"Channel: {result.get('channel_id')}")
    print("Runtime: Hermes")
    print(f"Task: {args.task}")
    print(f"Open tx: {result.get('open_tx_hash')}")
    explorer = result.get("explorer", {})
    if explorer.get("open_tx"):
        print(f"Arcscan: {explorer.get('open_tx')}")


def cmd_session_call(args) -> None:
    api_name = args.api_name.lower()
    if api_name not in API_IDS:
        print(f"ERROR: Unknown API '{api_name}'. Available: {', '.join(API_IDS)}", file=sys.stderr)
        sys.exit(1)

    key = _get_key(args.key)
    params: dict = {}
    if api_name == "gemini":
        if not args.prompt:
            print("ERROR: --prompt is required for gemini", file=sys.stderr)
            sys.exit(1)
        params["prompt"] = args.prompt
        if args.system:
            params["system"] = args.system
        if args.temperature is not None:
            params["temperature"] = args.temperature
        if args.max_output_tokens is not None:
            params["max_output_tokens"] = args.max_output_tokens
    elif api_name == "weather" and args.city:
        params["city"] = args.city
    elif api_name == "fx" and args.base:
        params["base"] = args.base
    elif api_name == "geoip" and args.ip:
        params["ip"] = args.ip
    elif api_name == "country" and args.name:
        params["country"] = args.name

    result = _request(
        "POST",
        "/api/session-call",
        {
            "channel_id": args.channel_id,
            "api_id": API_IDS[api_name],
            "params": params,
            "agent_runtime": "hermes",
            "task": args.task,
        },
        key=key,
        idempotency_key=_short_id("hsc"),
    )
    print(json.dumps(result, indent=2))
    session = result.get("session", {})
    voucher = result.get("voucher", {})
    print()
    print(f"Channel: {result.get('channel_id')}")
    print("Runtime: Hermes")
    print(f"Task: {args.task}")
    print(f"Calls total: {session.get('calls_total')}")
    print(f"Cumulative spent: {voucher.get('cumulative_usdc')} USDC")
    print(f"Remaining: {session.get('remaining_usdc')} USDC")


def cmd_session_close(args) -> None:
    key = _get_key(args.key)
    result = _request(
        "POST",
        "/api/session-close",
        {
            "channel_id": args.channel_id,
            "agent_runtime": "hermes",
            "task": args.task,
        },
        key=key,
        idempotency_key=_short_id("hsx"),
    )
    print(json.dumps(result, indent=2))
    print()
    print(f"Channel: {result.get('channel_id')}")
    print("Runtime: Hermes")
    print(f"Task: {args.task}")
    print(f"Close tx: {result.get('close_tx_hash')}")
    print(f"Calls total: {result.get('calls_total')}")
    print(f"Cumulative spent: {result.get('cumulative_spent_usdc')} USDC")
    print(f"Refund: {result.get('refunded_to_agent_usdc')} USDC")
    if result.get("explorer"):
        print(f"Arcscan: {result.get('explorer')}")


def cmd_webhook_subscribe(args) -> None:
    key = _get_key(args.key)
    body = {
        "arc_address": args.address,
        "url": args.url,
        "events": ["transfer.in", "transfer.out"],
    }
    result = _request("POST", "/api/webhooks", body, key=key)
    print(json.dumps(result, indent=2))


def cmd_webhook_list(args) -> None:
    key = _get_key(args.key)
    result = _request("GET", "/api/webhooks", key=key)
    print(json.dumps(result, indent=2))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="arcport",
        description="ArcPort Hermes skill — charge and session API payments on Arc",
    )
    sub = parser.add_subparsers(dest="command")

    p_wallet = sub.add_parser("wallet", help="Wallet management")
    wallet_sub = p_wallet.add_subparsers(dest="wallet_command")
    wallet_sub.add_parser("create", help="Create a legacy EOA wallet")
    wallet_sub.add_parser("create-circle", help="Create a Circle wallet identity for session mode")
    p_balance = wallet_sub.add_parser("balance", help="Check USDC balance")
    p_balance.add_argument("--key", default=None, help="Identity key (awi_...) or legacy agent key (apk_...)")
    p_fund = wallet_sub.add_parser("fund-url", help="Print a LI.FI/Jumper funding URL for the Arc wallet")
    p_fund.add_argument("--key", default=None, help="Identity key (awi_...) or legacy agent key (apk_...)")

    p_call = sub.add_parser("call", help="Call a paid API ($0.001 USDC)")
    p_call.add_argument(
        "api_name",
        choices=list(API_IDS),
        help="API to call: gemini, weather, fx, crypto, geoip, country, joke",
    )
    p_call.add_argument("--key", default=None, help="Identity key (awi_...) or legacy agent key (apk_...)")
    p_call.add_argument("--prompt", default=None, help="Prompt for Gemini")
    p_call.add_argument("--system", default=None, help="Optional Gemini system instruction")
    p_call.add_argument("--temperature", type=float, default=None, help="Optional Gemini temperature")
    p_call.add_argument("--max-output-tokens", type=int, default=None, help="Optional Gemini max output tokens")
    p_call.add_argument("--city", default=None, help="City name (weather)")
    p_call.add_argument("--base", default="USD", help="Base currency (fx)")
    p_call.add_argument("--ip", default=None, help="IP address (geoip)")
    p_call.add_argument("--name", default=None, help="Country name (country)")

    p_session = sub.add_parser("session", help="Session mode for repeated paid calls")
    session_sub = p_session.add_subparsers(dest="session_command")

    p_session_open = session_sub.add_parser("open", help="Open an onchain session budget")
    p_session_open.add_argument("--key", default=None, help="Identity key (awi_...)")
    p_session_open.add_argument("--calls", type=int, default=10, help="Expected call budget")
    p_session_open.add_argument("--deposit", type=float, default=None, help="Override deposit in USDC")
    p_session_open.add_argument("--task", default="ArcPort V3 Hermes runtime demo", help="Human-readable agent task label")
    p_session_open.add_argument(
        "--allowed-api",
        action="append",
        choices=list(API_IDS),
        default=["gemini"],
        help="API allowed by the session policy. Repeat for multiple APIs.",
    )

    p_session_call = session_sub.add_parser("call", help="Call a paid API inside an open session")
    p_session_call.add_argument("channel_id", help="Session channel id")
    p_session_call.add_argument("api_name", choices=list(API_IDS), help="API to call")
    p_session_call.add_argument("--key", default=None, help="Identity key (awi_...)")
    p_session_call.add_argument("--prompt", default=None, help="Prompt for Gemini")
    p_session_call.add_argument("--system", default=None, help="Optional Gemini system instruction")
    p_session_call.add_argument("--temperature", type=float, default=None, help="Optional Gemini temperature")
    p_session_call.add_argument("--max-output-tokens", type=int, default=None, help="Optional Gemini max output tokens")
    p_session_call.add_argument("--city", default=None, help="City name (weather)")
    p_session_call.add_argument("--base", default="USD", help="Base currency (fx)")
    p_session_call.add_argument("--ip", default=None, help="IP address (geoip)")
    p_session_call.add_argument("--name", default=None, help="Country name (country)")
    p_session_call.add_argument("--task", default="ArcPort V3 Hermes runtime demo", help="Human-readable agent task label")

    p_session_close = session_sub.add_parser("close", help="Close a session and refund unused budget")
    p_session_close.add_argument("channel_id", help="Session channel id")
    p_session_close.add_argument("--key", default=None, help="Identity key (awi_...)")
    p_session_close.add_argument("--task", default="ArcPort V3 Hermes runtime demo", help="Human-readable agent task label")

    p_wh = sub.add_parser("webhook", help="Webhook subscriptions")
    wh_sub = p_wh.add_subparsers(dest="webhook_command")

    p_sub = wh_sub.add_parser("subscribe", help="Subscribe to address events")
    p_sub.add_argument("--address", required=True, help="Arc address to watch")
    p_sub.add_argument("--url", required=True, help="Webhook delivery URL")
    p_sub.add_argument("--key", default=None, help="Agent key (apk_...)")

    p_list = wh_sub.add_parser("list", help="List subscriptions")
    p_list.add_argument("--key", default=None, help="Agent key (apk_...)")

    return parser


def main() -> None:
    parser = build_parser()
    args = parser.parse_args()

    if args.command == "wallet":
        if args.wallet_command == "create":
            cmd_wallet_create(args)
        elif args.wallet_command == "create-circle":
            cmd_wallet_create_circle(args)
        elif args.wallet_command == "balance":
            cmd_wallet_balance(args)
        elif args.wallet_command == "fund-url":
            cmd_wallet_fund_url(args)
        else:
            parser.parse_args(["wallet", "--help"])
    elif args.command == "call":
        cmd_call(args)
    elif args.command == "session":
        if args.session_command == "open":
            cmd_session_open(args)
        elif args.session_command == "call":
            cmd_session_call(args)
        elif args.session_command == "close":
            cmd_session_close(args)
        else:
            parser.parse_args(["session", "--help"])
    elif args.command == "webhook":
        if args.webhook_command == "subscribe":
            cmd_webhook_subscribe(args)
        elif args.webhook_command == "list":
            cmd_webhook_list(args)
        else:
            parser.parse_args(["webhook", "--help"])
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
