import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

function readLocalEnvValue(name) {
  const envPath = path.join(process.cwd(), '.env.local');
  if (!existsSync(envPath)) return null;

  const match = readFileSync(envPath, 'utf8')
    .split('\n')
    .map(line => line.trim())
    .find(line => line.startsWith(`${name}=`));

  if (!match) return null;
  return match.slice(name.length + 1).trim();
}

function getEnvValue(...names) {
  for (const name of names) {
    if (process.env[name]) return process.env[name];
    const localValue = readLocalEnvValue(name);
    if (localValue) return localValue;
  }
  return null;
}

const DEFAULT_GEMINI_MODEL = getEnvValue('GEMINI_MODEL') || 'gemini-2.5-flash';

function clampNumber(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(max, Math.max(min, n));
}

async function callGeminiInference(p) {
  const apiKey = getEnvValue('GEMINI_API_KEY', 'GOOGLE_AI_STUDIO_API_KEY');
  if (!apiKey) throw new Error('GEMINI_API_KEY or GOOGLE_AI_STUDIO_API_KEY is not configured');

  const prompt = String(p.prompt || '').trim();
  if (!prompt) throw new Error('prompt is required');

  const model = String(p.model || DEFAULT_GEMINI_MODEL).trim() || DEFAULT_GEMINI_MODEL;
  const temperature = clampNumber(p.temperature, 0, 2);
  const maxOutputTokens = clampNumber(p.max_output_tokens, 1, 8192);
  const system = String(p.system || '').trim();

  const body = {
    contents: [{
      role: 'user',
      parts: [{ text: prompt }],
    }],
  };

  if (system) {
    body.system_instruction = {
      parts: [{ text: system }],
    };
  }

  if (temperature !== null || maxOutputTokens !== null) {
    body.generationConfig = {};
    if (temperature !== null) body.generationConfig.temperature = temperature;
    if (maxOutputTokens !== null) body.generationConfig.maxOutputTokens = Math.round(maxOutputTokens);
  }

  const response = await fetch(`${GEMINI_API_BASE}/models/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });

  const raw = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(raw?.error?.message || `Gemini request failed: ${response.status}`);

  const candidate = raw?.candidates?.[0] || null;
  const parts = candidate?.content?.parts || [];
  const outputText = parts
    .filter(part => typeof part?.text === 'string')
    .map(part => part.text)
    .join('\n\n')
    .trim();

  return {
    model,
    prompt,
    output_text: outputText || '',
    finish_reason: candidate?.finishReason || null,
    usage: {
      prompt_tokens: raw?.usageMetadata?.promptTokenCount ?? null,
      output_tokens: raw?.usageMetadata?.candidatesTokenCount ?? null,
      total_tokens: raw?.usageMetadata?.totalTokenCount ?? null,
    },
    safety: {
      prompt_feedback: raw?.promptFeedback || null,
      candidate_ratings: candidate?.safetyRatings || [],
    },
    source: 'Google AI Studio / Gemini API',
    timestamp: new Date().toISOString(),
  };
}

export const BUILTIN_APIS = {
  'weather-1': async (p) => {
    const city = p.city || 'Berlin';
    const geo = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`).then(r => r.json());
    const loc = geo.results?.[0];
    if (!loc) throw new Error(`City not found: ${city}`);

    const weather = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${loc.latitude}&longitude=${loc.longitude}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code&timezone=auto`
    ).then(r => r.json());
    const current = weather.current;

    return {
      city: loc.name,
      country: loc.country,
      latitude: loc.latitude,
      longitude: loc.longitude,
      temperature_c: current.temperature_2m,
      humidity_pct: current.relative_humidity_2m,
      wind_kmh: current.wind_speed_10m,
      weather_code: current.weather_code,
      timezone: weather.timezone,
    };
  },
  'fx-1': async (p) => {
    const base = (p.base || 'USD').toUpperCase();
    const data = await fetch(`https://api.frankfurter.app/latest?from=${base}`).then(r => r.json());
    let rates = data.rates;

    if (p.currencies) {
      const list = p.currencies.split(',').map(code => code.trim().toUpperCase());
      rates = Object.fromEntries(Object.entries(rates).filter(([code]) => list.includes(code)));
    }

    return { base: data.base, date: data.date, rates, source: 'ECB via Frankfurter' };
  },
  'geo-1': async (p) => {
    const url = p.ip ? `https://ipapi.co/${p.ip}/json/` : 'https://ipapi.co/json/';
    const data = await fetch(url, { headers: { 'User-Agent': 'ArcPort/1.0' } }).then(r => r.json());
    if (data.error) throw new Error(data.reason || 'IP lookup failed');

    return {
      ip: data.ip,
      city: data.city,
      region: data.region,
      country: data.country_name,
      country_code: data.country_code,
      latitude: data.latitude,
      longitude: data.longitude,
      timezone: data.timezone,
      isp: data.org,
      currency: data.currency,
    };
  },
  'countries-1': async (p) => {
    const name = p.country || 'Germany';
    const data = await fetch(
      `https://restcountries.com/v3.1/name/${encodeURIComponent(name)}?fields=name,capital,population,area,languages,currencies,region,subregion,timezones`
    ).then(r => r.json());
    if (!Array.isArray(data) || !data[0]) throw new Error(`Country not found: ${name}`);

    const country = data[0];
    return {
      name: country.name.common,
      official_name: country.name.official,
      capital: country.capital?.[0],
      population: country.population,
      area_km2: country.area,
      region: country.region,
      subregion: country.subregion,
      languages: Object.values(country.languages || {}),
      currencies: Object.values(country.currencies || {}).map(item => `${item.name} (${item.symbol})`),
      timezones: country.timezones,
    };
  },
  'crypto-1': async (p) => {
    const coins = p.coins || 'bitcoin,ethereum,usd-coin';
    const vs = p.vs_currency || 'usd';
    const data = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${coins}&vs_currencies=${vs}&include_24hr_change=true`
    ).then(r => r.json());
    return { prices: data, vs_currency: vs, source: 'CoinGecko', timestamp: new Date().toISOString() };
  },
  'gemini-1': async (p) => {
    return callGeminiInference(p);
  },
  'joke-1': async (p) => {
    const url = p.type === 'programming'
      ? 'https://official-joke-api.appspot.com/jokes/programming/random'
      : 'https://official-joke-api.appspot.com/random_joke';
    const data = await fetch(url).then(r => r.json());
    const joke = Array.isArray(data) ? data[0] : data;
    return { setup: joke.setup, punchline: joke.punchline, type: joke.type };
  },
};

export function isBuiltinApi(apiId) {
  return Boolean(BUILTIN_APIS[apiId]);
}

export async function resolveMarketplaceApi(apiId, sbGet) {
  if (isBuiltinApi(apiId)) return null;
  const rows = await sbGet('apis', `id=eq.${encodeURIComponent(apiId)}`);
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

export async function callMarketplaceApi({ apiId, params = {}, apiRow, sbPatch }) {
  const builtin = BUILTIN_APIS[apiId];
  const started = Date.now();
  let data = null;
  let error = null;

  if (builtin) {
    try {
      data = await builtin(params);
    } catch (err) {
      error = err.message;
    }
  } else if (apiRow) {
    try {
      const response = await fetch(apiRow.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
        signal: AbortSignal.timeout(8000),
      });
      data = await response.json().catch(() => ({ raw: 'non-JSON' }));

      if (sbPatch) {
        await sbPatch('apis', `id=eq.${encodeURIComponent(apiId)}`, {
          calls_total: (apiRow.calls_total || 0) + 1,
          revenue: +((apiRow.revenue || 0) + 0.001).toFixed(6),
        });
      }
    } catch (err) {
      error = err.message;
    }
  } else {
    error = `API not found: ${apiId}`;
  }

  return {
    data,
    error,
    latency_ms: Date.now() - started,
  };
}
