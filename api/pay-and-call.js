// api/pay-and-call.js
// ArcPort — pay-per-call API gateway on Arc Testnet
//
// Payment flow (Circle Nanopayments + x402):
//   1. Agent requests API without X-Payment header → 402 + payment requirements
//   2. Agent signs EIP-3009 authorization (gas-free, offchain)
//   3. Agent retries with X-Payment header
//   4. Server verifies via Circle Nanopayments facilitator
//   5. Data returned + receipt recorded
//
// Fallback: legacy agent_key → direct Arc transfer (backwards compat)

const PRICE_USD       = '0.001';
const PRICE_ATOMIC    = '1000';                         // USDC 6 decimals
const ARC_CHAIN_ID    = 5042002;
const ARC_NETWORK     = 'eip155:5042002';               // CAIP-2 Arc Testnet
const USDC_ADDRESS    = '0x3600000000000000000000000000000000000000';
const CIRCLE_NP_URL   = 'https://gateway-api-testnet.circle.com/v1/nanopayments';
const X402_FALLBACK   = 'https://x402.org/facilitator';
const ARC_RPC         = 'https://rpc.testnet.arc.network';
const LEGACY_PRICE    = BigInt('1000');

// ── Built-in APIs ────────────────────────────────────────
const APIS = {
  'weather-1': async (p) => {
    const city = p.city || 'Berlin';
    const geo  = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`).then(r => r.json());
    const loc  = geo.results?.[0];
    if (!loc) throw new Error(`City not found: ${city}`);
    const w = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code&timezone=auto`).then(r => r.json());
    const c = w.current;
    return { city: loc.name, country: loc.country, latitude: loc.latitude, longitude: loc.longitude, temperature_c: c.temperature_2m, humidity_pct: c.relative_humidity_2m, wind_kmh: c.wind_speed_10m, weather_code: c.weather_code, timezone: w.timezone };
  },
  'fx-1': async (p) => {
    const base = (p.base || 'USD').toUpperCase();
    const d = await fetch(`https://api.frankfurter.app/latest?from=${base}`).then(r => r.json());
    let rates = d.rates;
    if (p.currencies) { const list = p.currencies.split(',').map(c => c.trim().toUpperCase()); rates = Object.fromEntries(Object.entries(rates).filter(([k]) => list.includes(k))); }
    return { base: d.base, date: d.date, rates, source: 'ECB via Frankfurter' };
  },
  'geo-1': async (p) => {
    const url = p.ip ? `https://ipapi.co/${p.ip}/json/` : 'https://ipapi.co/json/';
    const d = await fetch(url, { headers: { 'User-Agent': 'ArcPort/1.0' } }).then(r => r.json());
    if (d.error) throw new Error(d.reason || 'IP lookup failed');
    return { ip: d.ip, city: d.city, region: d.region, country: d.country_name, country_code: d.country_code, latitude: d.latitude, longitude: d.longitude, timezone: d.timezone, isp: d.org, currency: d.currency };
  },
  'countries-1': async (p) => {
    const name = p.country || 'Germany';
    const data = await fetch(`https://restcountries.com/v3.1/name/${encodeURIComponent(name)}?fields=name,capital,population,area,languages,currencies,region,subregion,timezones`).then(r => r.json());
    if (!Array.isArray(data) || !data[0]) throw new Error(`Country not found: ${name}`);
    const c = data[0];
    return { name: c.name.common, official_name: c.name.official, capital: c.capital?.[0], population: c.population, area_km2: c.area, region: c.region, subregion: c.subregion, languages: Object.values(c.languages || {}), currencies: Object.values(c.currencies || {}).map(x => `${x.name} (${x.symbol})`), timezones: c.timezones };
  },
  'crypto-1': async (p) => {
    const coins = p.coins || 'bitcoin,ethereum,usd-coin';
    const vs = p.vs_currency || 'usd';
    const data = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${coins}&vs_currencies=${vs}&include_24hr_change=true`).then(r => r.json());
    return { prices: data, vs_currency: vs, source: 'CoinGecko', timestamp: new Date().toISOString() };
  },
  'joke-1': async (p) => {
    const url = p.type === 'programming' ? 'https://official-joke-api.appspot.com/jokes/programming/random' : 'https://official-joke-api.appspot.com/random_joke';
    const data = await fetch(url).then(r => r.json());
    const j = Array.isArray(data) ? data[0] : data;
    return { setup: j.setup, punchline: j.punchline, type: j.type };
  },
};

// ── Supabase ─────────────────────────────────────────────
const sbH    = () => ({ 'Content-Type': 'application/json', 'apikey': process.env.SUPABASE_ANON_KEY, 'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}` });
const sbGet  = (t, f)    => fetch(`${process.env.SUPABASE_URL}/rest/v1/${t}?${f}&select=*`, { headers: sbH() }).then(r => r.json());
const sbPost = (t, body) => fetch(`${process.env.SUPABASE_URL}/rest/v1/${t}`, { method: 'POST', headers: { ...sbH(), 'Prefer': 'return=minimal' }, body: JSON.stringify(body) });
const sbPatch= (t, f, b) => fetch(`${process.env.SUPABASE_URL}/rest/v1/${t}?${f}`, { method: 'PATCH', headers: { ...sbH(), 'Prefer': 'return=minimal' }, body: JSON.stringify(b) });

// ── Payment requirements ──────────────────────────────────
function buildRequirements(payTo) {
  return {
    scheme: 'exact',
    network: ARC_NETWORK,
    maxAmountRequired: PRICE_ATOMIC,
    resource: '/api/pay-and-call',
    description: `ArcPort API gateway — $${PRICE_USD} USDC per call`,
    mimeType: 'application/json',
    payTo,
    maxTimeoutSeconds: 60,
    asset: USDC_ADDRESS,
    extra: { name: 'USDC', version: '2' },
  };
}

// ── Decode X-Payment header ───────────────────────────────
function decodePayment(header) {
  try { return JSON.parse(Buffer.from(header, 'base64').toString()); }
  catch { try { return JSON.parse(header); } catch { return null; } }
}

// ── Verify via Circle Nanopayments ────────────────────────
async function verifyPayment(xPayment, requirements) {
  const payload = decodePayment(xPayment);
  if (!payload) return { valid: false, error: 'Invalid X-Payment header encoding' };

  // Try Circle Nanopayments
  if (process.env.CIRCLE_API_KEY) {
    try {
      const r = await fetch(`${CIRCLE_NP_URL}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.CIRCLE_API_KEY}` },
        body: JSON.stringify({ x402Version: 1, payload, paymentRequirements: requirements }),
        signal: AbortSignal.timeout(8000),
      });
      const d = await r.json();
      if (d.isValid) return { valid: true, facilitator: 'circle-nanopayments', raw: d };
    } catch (e) {
      console.log('[ArcPort] Circle Nanopayments verify error:', e.message);
    }
  }

  // Fallback: x402.org
  try {
    const r = await fetch(`${X402_FALLBACK}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x402Version: 1, payload, paymentRequirements: requirements }),
      signal: AbortSignal.timeout(8000),
    });
    const d = await r.json();
    if (d.isValid) return { valid: true, facilitator: 'x402-org', raw: d };
    return { valid: false, error: d.invalidReason || 'Payment verification failed' };
  } catch (e) {
    return { valid: false, error: `Facilitator unavailable: ${e.message}` };
  }
}

// ── Settle via Circle Nanopayments ────────────────────────
async function settlePayment(xPayment, requirements) {
  const payload = decodePayment(xPayment);

  if (process.env.CIRCLE_API_KEY) {
    try {
      const r = await fetch(`${CIRCLE_NP_URL}/settle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.CIRCLE_API_KEY}` },
        body: JSON.stringify({ x402Version: 1, payload, paymentRequirements: requirements }),
        signal: AbortSignal.timeout(10000),
      });
      const d = await r.json();
      const txHash = d.txHash || d.transactionHash || d.settlementId;
      if (txHash || d.success) return { success: true, tx_hash: txHash || 'circle-nanopayment-batched', facilitator: 'circle-nanopayments' };
    } catch (e) {
      console.log('[ArcPort] Circle Nanopayments settle error:', e.message);
    }
  }

  // Fallback
  try {
    const r = await fetch(`${X402_FALLBACK}/settle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ x402Version: 1, payload, paymentRequirements: requirements }),
      signal: AbortSignal.timeout(10000),
    });
    const d = await r.json();
    return { success: !!d.success, tx_hash: d.txHash || 'x402-settlement', facilitator: 'x402-org' };
  } catch (e) {
    return { success: false, tx_hash: 'settlement-pending', error: e.message, facilitator: 'unknown' };
  }
}

// ── Legacy Arc direct transfer ────────────────────────────
async function legacyTransfer() {
  const { ethers } = await import('ethers');
  const ERC20_ABI  = ['function transfer(address to, uint256 amount) returns (bool)'];
  const provider   = new ethers.JsonRpcProvider(ARC_RPC, { chainId: ARC_CHAIN_ID, name: 'arc-testnet' });
  const wallet     = new ethers.Wallet(process.env.ARC_PRIVATE_KEY, provider);
  const usdc       = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, wallet);
  const recipient  = process.env.PLATFORM_ARC_ADDRESS || wallet.address;
  const tx         = await usdc.transfer(recipient, LEGACY_PRICE);
  const receipt    = await tx.wait();
  return receipt.hash;
}

// ── Call the API ──────────────────────────────────────────
async function callApi(api_id, params, apiRow) {
  const builtin = APIS[api_id];
  const tApi    = Date.now();
  let data = null, error = null;
  if (builtin) {
    try   { data  = await builtin(params); }
    catch (e) { error = e.message; }
  } else if (apiRow) {
    try {
      const r = await fetch(apiRow.endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params), signal: AbortSignal.timeout(8000),
      });
      data = await r.json().catch(() => ({ raw: 'non-JSON' }));
      await sbPatch('apis', `id=eq.${encodeURIComponent(api_id)}`, {
        calls_total: (apiRow.calls_total || 0) + 1,
        revenue:     +((apiRow.revenue || 0) + 0.001).toFixed(6),
      });
    } catch (e) { error = e.message; }
  }
  return { data, error, latency_ms: Date.now() - tApi };
}

// ── Main handler ──────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Payment, X-Payment-Response');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const t0 = Date.now();

  try {
    const { api_id, params = {} } = req.body || {};
    if (!api_id) return res.status(400).json({ error: 'api_id is required' });

    const xPayment = req.headers['x-payment'];
    const agentKey = (req.headers.authorization || '').replace('Bearer ', '').trim();
    const payTo    = process.env.PLATFORM_ARC_ADDRESS;
    const requirements = buildRequirements(payTo);

    // Load custom API from DB if needed
    let apiRow = null;
    if (!APIS[api_id]) {
      const rows = await sbGet('apis', `id=eq.${encodeURIComponent(api_id)}`);
      apiRow = rows[0];
      if (!apiRow) return res.status(404).json({ error: `API not found: ${api_id}` });
    }

    // ── PATH A: x402 Nanopayment ─────────────────────────
    if (xPayment) {
      const tPay = Date.now();

      const verification = await verifyPayment(xPayment, requirements);
      if (!verification.valid) {
        return res.status(402).json({
          x402Version: 1,
          error: 'Payment verification failed',
          reason: verification.error,
          accepts: [requirements],
        });
      }

      const { data, error: apiError, latency_ms } = await callApi(api_id, params, apiRow);
      const settlement = await settlePayment(xPayment, requirements);
      const payMs = Date.now() - tPay;

      await sbPost('transactions', {
        agent_key:    agentKey || 'x402',
        api_id,
        amount:       0.001,
        tx_hash:      settlement.tx_hash,
        arc_address:  'nanopayment',
        status:       'confirmed',
        payment_type: 'nanopayment',
        facilitator:  settlement.facilitator,
      }).catch(() => {});

      const txHash   = settlement.tx_hash;
      const explorer = txHash && !txHash.includes('batched') && !txHash.includes('pending')
        ? `https://testnet.arcscan.app/tx/${txHash}` : null;

      res.setHeader('X-Payment-Response', Buffer.from(JSON.stringify({
        success: true, txHash, network: ARC_NETWORK,
      })).toString('base64'));

      return res.status(200).json({
        success: true,
        payment: {
          amount:       PRICE_USD,
          currency:     'USDC',
          network:      'Arc Testnet',
          payment_type: 'nanopayment',
          facilitator:  settlement.facilitator,
          tx_hash:      txHash,
          explorer,
          finality_ms:  payMs,
          gas_fee:      '$0.00',
          note:         'Gas-free via Circle Nanopayments. Batched onchain settlement.',
        },
        api:      { id: api_id, latency_ms },
        data,
        error:    apiError || undefined,
        total_ms: Date.now() - t0,
      });
    }

    // ── PATH B: Legacy agent_key → Arc direct transfer ───
    if (agentKey && agentKey.startsWith('apk_')) {
      if (!process.env.ARC_PRIVATE_KEY) return res.status(500).json({ error: 'ARC_PRIVATE_KEY not configured' });

      const wallets = await sbGet('agent_wallets', `agent_key=eq.${encodeURIComponent(agentKey)}`);
      if (!wallets[0]) return res.status(401).json({ error: 'Invalid agent key' });

      const tPay = Date.now();
      const txHash = await legacyTransfer();
      const payMs  = Date.now() - tPay;

      const { data, error: apiError, latency_ms } = await callApi(api_id, params, apiRow);

      await sbPost('transactions', {
        agent_key:    agentKey,
        api_id,
        amount:       0.001,
        tx_hash:      txHash,
        arc_address:  wallets[0].arc_address,
        status:       'confirmed',
        payment_type: 'direct',
      }).catch(() => {});

      return res.status(200).json({
        success: true,
        payment: {
          amount:       PRICE_USD,
          currency:     'USDC',
          network:      'Arc Testnet',
          payment_type: 'direct',
          tx_hash:      txHash,
          explorer:     `https://testnet.arcscan.app/tx/${txHash}`,
          finality_ms:  payMs,
          gas_fee:      '$0.001',
        },
        api:      { id: api_id, latency_ms },
        data,
        error:    apiError || undefined,
        total_ms: Date.now() - t0,
      });
    }

    // ── No payment header, no agent key → 402 ────────────
    return res.status(402).json({
      x402Version: 1,
      error: 'Payment required',
      accepts: [requirements],
      instructions: {
        nanopayment: 'Deposit USDC to Gateway Wallet → sign EIP-3009 → send X-Payment header',
        legacy:      'Create wallet at arcport.xyz/wallet → use apk_ key in Authorization header',
        docs:        'https://developers.circle.com/gateway/nanopayments',
      },
    });

  } catch (err) {
    console.error('[ArcPort] Error:', err);
    return res.status(500).json({ error: err.message });
  }
}
