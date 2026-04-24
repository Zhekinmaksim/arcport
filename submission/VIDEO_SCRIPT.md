# ArcPort Demo Script

ArcPort V2 introduces session-based API payments for repeated agent usage.

## Recording order

Prerequisite: start with a prepared Circle wallet funded with at least `0.01 USDC` on Arc Testnet.

1. Open **Wallet**
2. Click **Open 10-call session**
3. Open **Playground**
4. Switch to **Session mode**
5. Select **Gemini Inference**
6. Run **3 paid prompts**
   - 1 short bullet answer
   - 1 one-line rewrite
   - 1 short JSON response
7. Return to **Wallet**
8. Click **Close session onchain**
9. Open **Proof Mode**
10. Show `open tx`, `close tx`, `calls total`, `spent`, `refund`, and `status`

## Voiceover

ArcPort has two payment modes, but the browser in this demo is only the control plane.

Charge mode is for one-off paid API calls through Circle Nanopayments.

Session mode is for repeated usage. This demo opens one session onchain, runs three paid Gemini prompts through signed offchain calls, then closes the session onchain and refunds the unused balance.

The point is simple: repeated machine usage should not require a fresh onchain payment step every time.

## End on this

Mention that the repo already includes proof for **51 onchain transactions** and explain that `$0.001` pricing breaks if every call has to pay traditional gas.

## Do not do this

- do not start with marketplace browsing
- do not list every API
- do not explain the whole codebase
- do not spend longer on charge mode than on session mode
