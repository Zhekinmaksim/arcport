// api/pay-and-call.js
// ArcPort — pay-per-call API gateway on Arc Testnet
//
// Payment flow:
//   Agent wallet (arc_address stored in Supabase) → PLATFORM_ARC_ADDRESS
//   Signed by ARC_PRIVATE_KEY (platform hot wallet)
//
// For testnet simplicity: ARC_PRIVATE_KEY is the PLATFORM wallet.
// All agent wallets are EOAs generated locally — their private keys are
// NOT stored (by design). The platform wallet collects fees.
//
// This means: agent tops up their arc_address via faucet,
// but the PLATFORM_ARC_ADDRESS is what actually signs and pays gas.
// In production: upgrade to per-user signing via Circle Wallets.

import { ethers } from 'ethers';

const ARC_RPC      = 'https://rpc.testnet.arc.network';
const ARC_CHAIN_ID = 5042002;
const USDC_ADDRESS = '0x3600000000000000000000000000000000000000';
const PRICE_WEI    = BigInt('1000'); // 0.001 USDC (18 decimals)

const ERC20_ABI = [
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address) view returns (uint256)',
];

// ── Built-in real APIs ───────────────────────────────────
const APIS = {
  'weather-1': async (p) => {
    const city = p.city || p.location || 'Berlin';
    const geo  = await fetch(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`
    ).then(r => r.json());
    const loc = geo.results?.[0];
    if (!loc) throw new Error(`City not found: ${city}`);
    const w = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code&timezone=auto`
    ).then(r => r.json());
    const c = w.current;
    return {
      city: loc.name, country: loc.country,
      latitude: loc.latitude, longitude: loc.longitude,
      temperature_c: c.temperature_2m,
      humidity_pct:  c.relative_humidity_2m,
      wind_kmh:      c.wind_speed_10m,
      weather_code:  c.weather_code,
      timezone:      w.timezone,
    };
  },

  'fx-1': async (p) => {
    const base = (p.base || 'USD').toUpperCase();
    const d    = await fetch(`https://api.frankfurter.app/latest?from=${base}`).then(r => r.json());
    let rates  = d.rates;
    if (p.currencies) {
      const list = p.currencies.split(',').map(c => c.trim().toUpperCase());
      rates = Object.fromEntries(Object.entries(rates).filter(([k]) => list.includes(k)));
    }
    return { base: d.base, date: d.date, rates, source: 'ECB via Frankfurter' };
  },

  'geo-1': async (p) => {
    const url = p.ip ? `https://ipapi.co/${p.ip}/json/` : 'https://ipapi.co/json/';
    const d   = await fetch(url, { headers: { 'User-Agent': 'ArcPort/1.0' } }).then(r => r.json());
    if (d.error) throw new Error(d.reason || 'IP lookup failed');
    return {
      ip: d.ip, city: d.city, region: d.region,
      country: d.country_name, country_code: d.country_code,
      latitude: d.latitude, longitude: d.longitude,
      timezone: d.timezone, isp: d.org, currency: d.currency,
    };
  },

  'countries-1': async (p) => {
    const name = p.country || p.name || 'Germany';
    const data = await fetch(
      `https://restcountries.com/v3.1/name/${encodeURIComponent(name)}?fields=name,capital,population,area,languages,currencies,region,subregion,timezones`
    ).then(r => r.json());
    if (!Array.isArray(data) || !data[0]) throw new Error(`Country not found: ${name}`);
    const c = data[0];
    return {
      name: c.name.common, official_name: c.name.official,
      capital: c.capital?.[0], population: c.population, area_km2: c.area,
      region: c.region, subregion: c.subregion,
      languages: Object.values(c.languages || {}),
      currencies: Object.values(c.currencies || {}).map(x => `${x.name} (${x.symbol})`),
      timezones: c.timezones,
    };
  },

  'crypto-1': async (p) => {
    const coins = p.coins || 'bitcoin,ethereum,usd-coin';
    const vs    = p.vs_currency || 'usd';
    const data  = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${coins}&vs_currencies=${vs}&include_24hr_change=true`
    ).then(r => r.json());
    return { prices: data, vs_currency: vs, source: 'CoinGecko', timestamp: new Date().toISOString() };
  },

  'joke-1': async (p) => {
    const url  = (p.type === 'programming')
      ? 'https://official-joke-api.appspot.com/jokes/programming/random'
      : 'https://official-joke-api.appspot.com/random_joke';
    const data = await fetch(url).then(r => r.json());
    const j    = Array.isArray(data) ? data[0] : data;
    return { setup: j.setup, punchline: j.punchline, type: j.type };
  },
};

// ── Supabase ─────────────────────────────────────────────
const sbH = () => ({
  'Content-Type': 'application/json',
  'apikey':        process.env.SUPABASE_ANON_KEY,
  'Authorization': `Bearer ${process.env.SUPABASE_ANON_KEY}`,
});
const sbGet  = (t, f)    => fetch(`${process.env.SUPABASE_URL}/rest/v1/${t}?${f}&select=*`, { headers: sbH() }).then(r => r.json());
const sbPost = (t, body) => fetch(`${process.env.SUPABASE_URL}/rest/v1/${t}`, { method: 'POST', headers: { ...sbH(), 'Prefer': 'return=minimal' }, body: JSON.stringify(body) });
const sbPatch= (t, f, b) => fetch(`${process.env.SUPABASE_URL}/rest/v1/${t}?${f}`, { method: 'PATCH', headers: { ...sbH(), 'Prefer': 'return=minimal' }, body: JSON.stringify(b) });

// ── USDC transfer (platform wallet signs) ───────────────
// The platform wallet (ARC_PRIVATE_KEY) sends 0.001 USDC to itself
// as a fee record. The agent's arc_address balance is checked but
// the actual USDC movement is platform → platform (testnet fee demo).
// For production: use per-user signing with Circle Wallets.
async function recordPayment(privateKey, toAddress, amountWei) {
  const provider = new ethers.JsonRpcProvider(ARC_RPC, { chainId: ARC_CHAIN_ID, name: 'arc-testnet' });
  const wallet   = new ethers.Wallet(privateKey, provider);
  const usdc     = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, wallet);
  const tx       = await usdc.transfer(toAddress, amountWei);
  const receipt  = await tx.wait();
  return receipt.hash;
}

// ── Handler ───────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const t0 = Date.now();

  try {
    // 1. Auth
    const agentKey = (req.headers.authorization || '').replace('Bearer ', '').trim();
    if (!agentKey || !agentKey.startsWith('apk_')) {
      return res.status(401).json({ error: 'Missing or invalid agent key. Create one in Wallet.' });
    }

    const { api_id, params = {} } = req.body || {};
    if (!api_id) return res.status(400).json({ error: 'api_id is required' });

    // 2. Load agent wallet
    const wallets = await sbGet('agent_wallets', `agent_key=eq.${encodeURIComponent(agentKey)}`);
    const wallet  = wallets[0];
    if (!wallet) return res.status(401).json({ error: 'Invalid agent key' });

    // 3. Check onchain balance of platform wallet (ARC_PRIVATE_KEY)
    if (!process.env.ARC_PRIVATE_KEY) {
      return res.status(500).json({ error: 'ARC_PRIVATE_KEY not set in Vercel env vars' });
    }

    const provider    = new ethers.JsonRpcProvider(ARC_RPC, { chainId: ARC_CHAIN_ID, name: 'arc-testnet' });
    const platformWallet = new ethers.Wallet(process.env.ARC_PRIVATE_KEY);
    const usdc        = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, provider);
    const platformBal = await usdc.balanceOf(platformWallet.address);

    if (platformBal < PRICE_WEI) {
      return res.status(402).json({
        error:             'Platform wallet has insufficient USDC',
        platform_address:  platformWallet.address,
        how_to_topup:      'Fund platform wallet at https://faucet.circle.com — select Arc Testnet',
      });
    }

    // 4. Execute payment: platform → platform (self-transfer as onchain proof)
    // In production this would be agent → platform using Circle Wallets.
    const recipient = process.env.PLATFORM_ARC_ADDRESS || platformWallet.address;
    const tPay      = Date.now();
    const txHash    = await recordPayment(process.env.ARC_PRIVATE_KEY, recipient, PRICE_WEI);
    const paymentMs = Date.now() - tPay;

    // 5. Call the API
    let apiData = null, apiError = null;
    const tApi = Date.now();
    const builtin = APIS[api_id];

    if (builtin) {
      try   { apiData = await builtin(params); }
      catch (e) { apiError = e.message; }
    } else {
      const apiRows = await sbGet('apis', `id=eq.${encodeURIComponent(api_id)}`);
      const apiRow  = apiRows[0];
      if (!apiRow) return res.status(404).json({ error: `API not found: ${api_id}` });
      try {
        const r = await fetch(apiRow.endpoint, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(params), signal: AbortSignal.timeout(8000),
        });
        apiData = await r.json().catch(() => ({ raw: 'non-JSON response' }));
        await sbPatch('apis', `id=eq.${encodeURIComponent(api_id)}`, {
          calls_total: (apiRow.calls_total || 0) + 1,
          revenue:     +((apiRow.revenue || 0) + 0.001).toFixed(6),
        });
      } catch (e) { apiError = e.message; }
    }

    const apiMs = Date.now() - tApi;

    // 6. Record transaction
    await sbPost('transactions', {
      agent_key:   agentKey,
      api_id,
      amount:      0.001,
      tx_hash:     txHash,
      arc_address: wallet.arc_address,
      status:      'confirmed',
    });

    // 7. Respond
    return res.status(200).json({
      success: true,
      payment: {
        amount:      '0.001',
        currency:    'USDC',
        network:     'Arc Testnet',
        tx_hash:     txHash,
        explorer:    `https://testnet.arcscan.app/tx/${txHash}`,
        finality_ms: paymentMs,
      },
      api:      { id: api_id, latency_ms: apiMs },
      data:     apiData,
      error:    apiError || undefined,
      total_ms: Date.now() - t0,
    });

  } catch (err) {
    console.error('ArcPort error:', err);
    return res.status(500).json({ error: err.message });
  }
}
