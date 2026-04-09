-- AgentPay — Supabase Schema
-- Run in: Supabase → SQL Editor → Run

CREATE TABLE agent_wallets (
  id               UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_key        TEXT    UNIQUE NOT NULL,
  arc_address      TEXT,
  circle_wallet_id TEXT,
  balance          NUMERIC DEFAULT 0,
  created_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE apis (
  id                TEXT PRIMARY KEY,
  name              TEXT    NOT NULL,
  description       TEXT    DEFAULT '',
  endpoint          TEXT    NOT NULL,
  category          TEXT    DEFAULT 'Other',
  owner_arc_address TEXT,
  calls_total       INT     DEFAULT 0,
  revenue           NUMERIC DEFAULT 0,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE transactions (
  id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_key   TEXT,
  api_id      TEXT,
  amount      NUMERIC DEFAULT 0.001,
  tx_hash     TEXT,
  arc_address TEXT,
  status      TEXT    DEFAULT 'confirmed',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE webhook_subscriptions (
  id                 UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_key          TEXT    NOT NULL,
  arc_address        TEXT    NOT NULL,
  url                TEXT    NOT NULL,
  events             TEXT[]  DEFAULT ARRAY['transfer.in', 'transfer.out'],
  secret             TEXT    NOT NULL,
  active             BOOLEAN DEFAULT true,
  last_block_checked BIGINT,
  last_triggered     TIMESTAMPTZ,
  deliveries_total   INT     DEFAULT 0,
  deliveries_failed  INT     DEFAULT 0,
  created_at         TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE webhook_deliveries (
  id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id UUID    REFERENCES webhook_subscriptions(id) ON DELETE CASCADE,
  tx_hash         TEXT,
  event           TEXT,
  payload         JSONB,
  status          TEXT    DEFAULT 'pending',
  http_status     INT,
  error           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Row Level Security (open for Vercel Functions via anon key)
ALTER TABLE agent_wallets         ENABLE ROW LEVEL SECURITY;
ALTER TABLE apis                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_deliveries    ENABLE ROW LEVEL SECURITY;

CREATE POLICY "open" ON agent_wallets         FOR ALL USING (true);
CREATE POLICY "open" ON apis                  FOR ALL USING (true);
CREATE POLICY "open" ON transactions          FOR ALL USING (true);
CREATE POLICY "open" ON webhook_subscriptions FOR ALL USING (true);
CREATE POLICY "open" ON webhook_deliveries    FOR ALL USING (true);

-- Seed marketplace with 6 real APIs
INSERT INTO apis (id, name, description, endpoint, category) VALUES
  ('weather-1',   'Weather Pro',   'Real-time weather by city. Powered by Open-Meteo.',        'open-meteo.com',                'Data'),
  ('fx-1',        'FX Rates',      'Live forex rates from ECB. 30+ currencies.',               'frankfurter.app',               'Finance'),
  ('geo-1',       'GeoIP Lookup',  'IP address to location, ISP, timezone.',                   'ipapi.co',                      'Infra'),
  ('countries-1', 'Country Data',  'Capital, population, languages for any country.',          'restcountries.com',             'Data'),
  ('crypto-1',    'Crypto Prices', 'Live BTC/ETH prices with 24h change. CoinGecko.',         'coingecko.com',                 'Finance'),
  ('joke-1',      'Random Joke',   'Random joke — great for testing agent integrations.',      'official-joke-api.appspot.com', 'Other');
