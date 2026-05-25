# ArcPort Next + wagmi Session Client

This is a reference frontend for ArcPort session payments.

It is intentionally separate from the production ArcPort control plane. The goal is to show how a wallet-native React/Next frontend can wire:

- `wagmi` account connection
- `viem` typed data helpers and contract reads/writes
- x402 payment requirements
- session key policy intent
- ArcPort open -> calls -> close -> proof lifecycle

This example is not the production app. It is a small reference client for builders who want a frontend repo that demonstrates ArcPort's wallet-facing primitives.

## Why This Exists

ArcPort already exposes a machine-facing session runtime:

1. `POST /api/session-open`
2. `POST /api/session-call`
3. `POST /api/session-close`
4. `GET /api/session-proof`

The production app uses a web control plane and Circle wallet identities. This example shows the frontend shape for a wallet-native client where a connected wallet can review x402 requirements, create a session policy, and follow the same payment lifecycle.

## Demo Flow

```text
Connect wallet
  -> read x402 payment requirements
  -> review session key policy
  -> open bounded session
  -> make paid calls through ArcPort
  -> close session
  -> inspect refund and Arcscan proof
```

## What Is Implemented

- A Next.js app shell.
- A wagmi/viem configuration for Arc Testnet.
- A reference x402 requirements card.
- A session policy card that models allowed APIs, max calls, budget, and expiry.
- Client helpers for ArcPort session API calls.
- Contract ABI helpers for the deployed ArcPort session contract.

## What Is Intentionally Stubbed

This example does not hold private keys, does not perform production wallet delegation, and does not replace Circle wallet identity signing. Session keys are modeled as frontend policy intent so the UI can show how a wallet-native client should reason about bounded agent spend.

The production settlement path remains ArcPort's session API and Solidity contract.

## Run Locally

```bash
cd examples/next-wagmi-session-client
npm install
npm run dev
```

Set these if you want to call a non-production ArcPort instance:

```bash
NEXT_PUBLIC_ARCPORT_URL=https://arcport.xyz
NEXT_PUBLIC_ARCPORT_CONTRACT=0x594a7E570d1f915f1e11d504d0e89de28680cC98
```

## Mainnet Direction

The intended production shape is:

- wallet connects through wagmi
- frontend reads x402 payment requirements
- wallet signs a bounded session policy
- agent runtime spends within that policy
- final settlement closes on Arc
- user sees refund and proof

