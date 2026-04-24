# ArcPort Hackathon Evidence

ArcPort V2 introduces session-based API payments for repeated agent usage.

This folder exists to cover the core judging points with one compact evidence set:

- **charge mode**
- **session mode**
- **51 onchain transactions**
- **why `$0.001` breaks under traditional gas**

## Charge Mode

Charge mode is the one-off payment path.

What it shows:

- Arc
- USDC
- Circle Nanopayments
- real per-action pricing at `$0.001`

Why it matters:

- it is the direct Circle path the hackathon asks for
- it proves one-off paid API access works without subscriptions or prepaid plans

## Session Mode

Session mode is the repeated-usage path.

What it shows:

- one onchain session open
- repeated signed calls offchain
- one onchain close
- refund of unused balance

Why it matters:

- pay-per-call alone is not enough for repeated machine usage
- session mode is the new product primitive in ArcPort V2
- the demo can now be shown against **Gemini Inference** through Google AI Studio, not only data APIs

## 51 Onchain Transactions

ArcPort generated **51 onchain transactions** from a reproducible session proof run.

Breakdown:

- `17` approve transactions
- `17` session open transactions
- `17` session close transactions

Artifacts:

- [session-proof-latest.md](../proof/session-proof-latest.md)
- [session-proof-latest.json](../proof/session-proof-latest.json)
- [SESSION_PROOF_RUNBOOK.md](../proof/SESSION_PROOF_RUNBOOK.md)

Deployed session contract:

- [0x594a7E570d1f915f1e11d504d0e89de28680cC98](https://testnet.arcscan.app/address/0x594a7E570d1f915f1e11d504d0e89de28680cC98?tab=txs)

Representative Arcscan links:

- Cycle 1 approve: [0xcacae281b7706f742bec81c99dc8241200efd8e7f70c93617faf7f8227b261bb](https://testnet.arcscan.app/tx/0xcacae281b7706f742bec81c99dc8241200efd8e7f70c93617faf7f8227b261bb)
- Cycle 1 open: [0x903df55846219cf2130f6384526bee4193efea721cd6ea982e62634a6b3079ba](https://testnet.arcscan.app/tx/0x903df55846219cf2130f6384526bee4193efea721cd6ea982e62634a6b3079ba)
- Cycle 1 close: [0x7509816fe1e0d42129010cb7fe803e490592ea768d93f5a86b7e8988272f2771](https://testnet.arcscan.app/tx/0x7509816fe1e0d42129010cb7fe803e490592ea768d93f5a86b7e8988272f2771)
- Cycle 17 approve: [0xd0aefc46db8bf31015fe344f1c89d1f76c28351912b4d853d5ece26b0277742c](https://testnet.arcscan.app/tx/0xd0aefc46db8bf31015fe344f1c89d1f76c28351912b4d853d5ece26b0277742c)
- Cycle 17 open: [0xba9a446bbb30d839fd1b023496417e754d4bab13003c3f9e4526de92e34ddeb0](https://testnet.arcscan.app/tx/0xba9a446bbb30d839fd1b023496417e754d4bab13003c3f9e4526de92e34ddeb0)
- Cycle 17 close: [0x93d1caa1a3ec85daf6296f8d77f57d56aaf9f4fbdacc0d2257f5f988daae115d](https://testnet.arcscan.app/tx/0x93d1caa1a3ec85daf6296f8d77f57d56aaf9f4fbdacc0d2257f5f988daae115d)

## Why `$0.001` Breaks With Traditional Gas

If every `$0.001` API call required its own onchain payment transaction, gas would cost more than the call itself.

That breaks the model:

- negative unit economics on small calls
- too much latency for repeated usage
- too much payment overhead for agents making many calls

ArcPort addresses this with two paths:

- **charge mode** removes per-call onchain execution from the buyer path
- **session mode** amortizes onchain cost across repeated usage

## One-Line Summary

Charge mode shows the required Circle path.
Session mode is the new primitive.
The repo already has 51 onchain transactions to prove it.
