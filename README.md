# ArcPort

ArcPort is an API marketplace where AI agents pay $0.001 USDC per call. Payments settle onchain via Arc in under one second — no subscriptions, no invoices, no credit cards.

---

## The problem

Most APIs today charge monthly subscriptions or require billing setup. For AI agents that make thousands of small, unpredictable requests across many providers, this model breaks down. An agent can't sign up for a plan.

ArcPort flips this: every API call is a micropayment. The agent pays exactly for what it uses, the moment it uses it — onchain, verifiable, no intermediary.

---

## How it works

Each request goes through three steps:

1. **Auth** — request arrives with an agent key (`apk_...`) in the Authorization header
2. **Payment** — 0.001 USDC is transferred onchain via Arc Testnet before the API is called
3. **Delivery** — the API responds; the caller gets both the data and a transaction hash

The transaction hash links every piece of data to an onchain payment. You can verify any call at [testnet.arcscan.app](https://testnet.arcscan.app).

---

## Marketplace

Six real APIs are available out of the box, all running against live public endpoints with no API keys required:

| API | Data | Endpoint |
|-----|------|----------|
| Weather Pro | Temperature, humidity, wind by city | Open-Meteo |
| FX Rates | Live exchange rates, 30+ currencies | Frankfurter / ECB |
| GeoIP Lookup | City, country, timezone, ISP from IP | ipapi.co |
| Country Data | Capital, population, languages, currency | restcountries.com |
| Crypto Prices | BTC, ETH, USDC prices with 24h change | CoinGecko |
| Random Joke | Because end-to-end tests need data too | official-joke-api |

Anyone can register their own API and start earning USDC per call.

---

## Webhooks

ArcPort ships a built-in Webhook API — subscribe to any Arc address and receive HTTP POST notifications when USDC moves.

- Worker runs every minute via Vercel Cron
- Queries Arc chain for Transfer events using ethers.js
- Delivers signed payloads (`X-ArcPort-Signature: sha256=...`)
- Up to 10 active subscriptions per agent key

Verify authenticity:

```js
import { createHmac } from 'crypto'

function verify(req, secret) {
  const sig = req.headers['x-arcport-signature']
  const expected = 'sha256=' + createHmac('sha256', secret)
    .update(JSON.stringify(req.body))
    .digest('hex')
  return sig === expected
}
```

---

## API reference

### Create wallet
```http
POST /api/wallet
Content-Type: application/json

{ "action": "create" }
```

Returns an `agent_key` and an `arc_address`. Fund the address at [faucet.circle.com](https://faucet.circle.com) (select Arc Testnet) to get 10 USDC.

### Check balance
```http
GET /api/wallet
Authorization: Bearer apk_...
```

Balance is read directly from Arc chain via `eth_call` — not from a database.

### Call an API
```http
POST /api/pay-and-call
Authorization: Bearer apk_...
Content-Type: application/json

{
  "api_id": "weather-1",
  "params": { "city": "Berlin" }
}
```

Response:
```json
{
  "success": true,
  "payment": {
    "amount": "0.001",
    "currency": "USDC",
    "network": "Arc Testnet",
    "tx_hash": "0xabc...def",
    "explorer": "https://testnet.arcscan.app/tx/0xabc...def",
    "finality_ms": 340
  },
  "data": { ... }
}
```

### Subscribe to webhook
```http
POST /api/webhooks
Authorization: Bearer apk_...
Content-Type: application/json

{
  "arc_address": "0x...",
  "url": "https://your-server.com/webhook",
  "events": ["transfer.in", "transfer.out"]
}
```

---

## Stack

| Layer | Technology |
|-------|-----------|
| Blockchain | Arc Testnet — EVM-compatible L1 by Circle |
| Payments | ethers.js — direct USDC transfer via ERC-20 |
| Backend | Vercel Functions — Node.js, ES modules |
| Database | Supabase — Postgres, RLS enabled |
| Cron | Vercel Cron — webhook worker every 60s |

---

## Self-hosting

**Prerequisites:** Node.js 18+, a Supabase project, a Vercel account.

**1. Database**

Run `schema.sql` in your Supabase SQL Editor. Creates five tables: `agent_wallets`, `apis`, `transactions`, `webhook_subscriptions`, `webhook_deliveries`.

**2. Platform wallet**

Generate an EOA and fund it with testnet USDC:

```bash
node -e "
const {ethers} = require('ethers');
const w = ethers.Wallet.createRandom();
console.log('address:', w.address);
console.log('privateKey:', w.privateKey);
"
```

Then get USDC at [faucet.circle.com](https://faucet.circle.com) → Arc Testnet → paste address.

**3. Deploy to Vercel**

Fork this repo, import into Vercel, add environment variables:

| Variable | Value |
|----------|-------|
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_ANON_KEY` | Supabase anon key |
| `ARC_PRIVATE_KEY` | Platform wallet private key |
| `PLATFORM_ARC_ADDRESS` | Platform wallet address |
| `CRON_SECRET` | Any random string — protects the webhook worker |

---

## Arc Network

Arc is a Layer-1 blockchain by Circle where USDC is the native gas token. Every transaction on ArcPort costs a fixed, predictable amount in dollars — no ETH price exposure, no gas spikes.

| | |
|-|-|
| RPC | https://rpc.testnet.arc.network |
| Chain ID | 5042002 |
| USDC contract | `0x3600000000000000000000000000000000000000` |
| Block explorer | https://testnet.arcscan.app |
| Faucet | https://faucet.circle.com |

---

## License

MIT
