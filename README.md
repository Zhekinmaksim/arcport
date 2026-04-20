# ArcPort

ArcPort is a machine-native API marketplace on Arc.

AI agents pay **$0.001 USDC per request**. No subscriptions. No invoices. No human checkout flow.

The goal is simple: an agent should be able to buy exactly one API response the moment it needs it.

---

## Why it exists

Most APIs are priced for humans. Plans, seats, billing dashboards, and monthly invoices all assume a person is making the purchase decision.

Agents do not work that way. They need to pay for a service at runtime, autonomously, per request, and at very small price points.

ArcPort is built around that constraint.

---

## Payment model

ArcPort currently supports two payment paths:

1. **Circle Nanopayments + x402 rails**
   The client sends an `X-Payment` header containing an offchain EIP-3009 authorization. ArcPort verifies the payment, confirms it immediately, and returns the API response. Settlement is handled later in batches on Arc.

2. **Legacy direct Arc transfer**
   The client sends an `apk_...` agent key in the `Authorization` header. ArcPort executes a direct USDC transfer on Arc Testnet before the API response is returned. This path remains available for backwards compatibility and the current demo UI.

In both cases, each request costs **$0.001 USDC** and returns verifiable payment metadata.

Today, the public demo UI still uses the legacy `agent_key` flow in Playground. Machine clients can call the nanopayment path directly by sending an `X-Payment` header.

---

## Marketplace

Six APIs are available out of the box:

| API | What it returns | Source |
|-----|------------------|--------|
| Weather Pro | Temperature, humidity, wind by city | Open-Meteo |
| FX Rates | Live exchange rates from the ECB | Frankfurter |
| GeoIP Lookup | City, country, timezone, ISP from IP | ipapi.co |
| Country Data | Capital, population, languages, currencies | restcountries.com |
| Crypto Prices | BTC, ETH, USDC prices with 24h change | CoinGecko |
| Random Joke | A simple test endpoint for agent integrations | official-joke-api |

Any developer can register an endpoint in the marketplace and charge per request instead of per month.

The repo also includes [`api/arc-stats.js`](./api/arc-stats.js), a demo custom endpoint that returns live Arc chain data and can be registered in the marketplace.

---

## Webhooks

ArcPort includes a webhook API.

Subscribe to any Arc address and receive a signed HTTP POST when USDC moves.

- Worker runs every 5 minutes via GitHub Actions cron
- Arc is polled with `ethers.js` for `Transfer` events
- Payloads are signed with `HMAC-SHA256` and delivered with `X-AgentPay-Signature`
- Up to 10 active subscriptions per agent key

Verify authenticity:

```js
import { createHmac } from 'crypto'

function verify(req, secret) {
  const sig = req.headers['x-agentpay-signature']
  const expected = 'sha256=' + createHmac('sha256', secret)
    .update(JSON.stringify(req.body))
    .digest('hex')
  return sig === expected
}
```

---

## API reference

### Create a legacy wallet

```http
POST /api/wallet
Content-Type: application/json

{ "action": "create" }
```

Returns an `agent_key` and an `arc_address`.

### Create a Circle wallet

```http
POST /api/wallet
Content-Type: application/json

{ "action": "create_circle" }
```

Returns an `agent_key`, `arc_address`, and `circle_wallet_id`.

Fund either wallet manually at [faucet.circle.com](https://faucet.circle.com) using **Arc Testnet**.

### Check balance

```http
GET /api/wallet
Authorization: Bearer apk_...
```

Balance is read directly from Arc via `eth_call`. Circle-backed wallets can also expose Circle-specific balance metadata.

### Call an API with legacy auth

```http
POST /api/pay-and-call
Authorization: Bearer apk_...
Content-Type: application/json

{
  "api_id": "weather-1",
  "params": { "city": "Berlin" }
}
```

### Call an API with nanopayments

```http
POST /api/pay-and-call
X-Payment: <base64-encoded payment payload>
Content-Type: application/json

{
  "api_id": "weather-1",
  "params": { "city": "Berlin" }
}
```

### Subscribe to webhooks

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
| Chain | Arc Testnet |
| Payments | Circle Dev-Controlled Wallets, Circle Nanopayments, x402 fallback |
| Legacy fallback | Direct USDC transfer via `ethers.js` |
| Backend | Vercel Functions, Node.js ES modules |
| Database | Supabase Postgres |
| Worker | GitHub Actions cron every 5 minutes |

---

## Self-hosting

**Prerequisites:** Node.js 18+, a Supabase project, a Vercel account.

### 1. Database

Run `schema.sql` in your Supabase SQL Editor. It creates:

- `agent_wallets`
- `apis`
- `transactions`
- `webhook_subscriptions`
- `webhook_deliveries`

### 2. Platform wallet

For the legacy direct-transfer flow, generate and fund an EOA:

```bash
node -e "
const {ethers} = require('ethers');
const w = ethers.Wallet.createRandom();
console.log('address:', w.address);
console.log('privateKey:', w.privateKey);
"
```

Then get testnet USDC at [faucet.circle.com](https://faucet.circle.com) and select **Arc Testnet**.

### 3. Deploy to Vercel

Import the repo into Vercel and configure environment variables:

| Variable | Required | Purpose |
|----------|----------|---------|
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_ANON_KEY` | Yes | Supabase anon key |
| `ARC_PRIVATE_KEY` | Legacy flow | Platform wallet private key |
| `PLATFORM_ARC_ADDRESS` | Legacy flow | Platform wallet address |
| `CIRCLE_API_KEY` | Circle flow | Circle API access |
| `CIRCLE_ENTITY_SECRET` | Circle flow | Circle entity secret used to create Circle wallets |
| `CIRCLE_WALLET_SET_ID` | Circle flow | Existing Circle wallet set ID |
| `CRON_SECRET` | Yes | Protects `/api/webhook-worker` |

### 4. Configure GitHub Actions cron

Add the same `CRON_SECRET` value to your GitHub repository under `Settings -> Secrets and variables -> Actions`, then enable the `Webhook Worker` workflow.

GitHub Actions calls the deployed `/api/webhook-worker` endpoint every 5 minutes.

---

## Arc Network

Arc is an EVM-compatible Layer 1 from Circle where USDC is the gas asset.

That makes ArcPort a good fit for machine payments: fees are denominated in dollars instead of a volatile native token, and every request can be priced in the same unit the agent actually spends.

| | |
|-|-|
| RPC | https://rpc.testnet.arc.network |
| Chain ID | 5042002 |
| USDC contract | `0x3600000000000000000000000000000000000000` |
| Explorer | https://testnet.arcscan.app |
| Faucet | https://faucet.circle.com |

---

## License

MIT
