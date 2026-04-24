-- ArcPort V2 additive migration for an existing V1 Supabase project.
-- Safe to run on top of the current schema without dropping tables.
-- Do NOT run schema.sql instead of this file on a live V1 database.

alter table agent_wallets add column if not exists wallet_id text;
alter table agent_wallets add column if not exists identity_key text;
alter table agent_wallets add column if not exists wallet_type text default 'eoa';
alter table agent_wallets add column if not exists custody_provider text default 'self';
alter table agent_wallets add column if not exists default_asset text default 'USDC';
alter table agent_wallets add column if not exists default_network text default 'ARC-TESTNET';
alter table agent_wallets add column if not exists gateway_enabled boolean default false;
alter table agent_wallets add column if not exists status text default 'active';
alter table agent_wallets add column if not exists metadata jsonb default '{}'::jsonb;

create unique index if not exists agent_wallets_wallet_id_uidx
  on agent_wallets(wallet_id)
  where wallet_id is not null;

create unique index if not exists agent_wallets_identity_key_uidx
  on agent_wallets(identity_key)
  where identity_key is not null;

alter table transactions add column if not exists wallet_id text;
alter table transactions add column if not exists identity_key text;
alter table transactions add column if not exists payer_arc_address text;
alter table transactions add column if not exists payee_arc_address text;
alter table transactions add column if not exists payment_asset text default 'USDC';
alter table transactions add column if not exists payment_network text default 'ARC-TESTNET';
alter table transactions add column if not exists payer_wallet_type text;
alter table transactions add column if not exists custody_provider text;
alter table transactions add column if not exists payment_type text default 'nanopayment';
alter table transactions add column if not exists settlement_channel text;
alter table transactions add column if not exists facilitator text;

alter table webhook_subscriptions add column if not exists wallet_id text;
alter table webhook_subscriptions add column if not exists identity_key text;

create table if not exists session_channels (
  id                   uuid primary key default gen_random_uuid(),
  channel_id           text unique not null,
  wallet_id            text,
  identity_key         text,
  agent_key            text,
  agent_arc_address    text not null,
  circle_wallet_id     text,
  contract_address     text not null,
  deposit_amount       numeric not null,
  deposit_atomic       text not null,
  cumulative_spent     numeric default 0,
  cumulative_atomic    text default '0',
  calls_total          int default 0,
  status               text default 'open',
  approve_tx_hash      text,
  open_tx_hash         text,
  close_tx_hash        text,
  refund_tx_hash       text,
  expires_at           timestamptz,
  closed_at            timestamptz,
  metadata             jsonb default '{}'::jsonb,
  created_at           timestamptz default now()
);

create table if not exists idempotency_requests (
  id                uuid primary key default gen_random_uuid(),
  request_key       text unique not null,
  request_scope     text not null,
  wallet_id         text,
  channel_id        text,
  status            text default 'pending',
  request_body      jsonb default '{}'::jsonb,
  response_status   int,
  response_body     jsonb,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

create unique index if not exists idempotency_requests_session_call_pending_uidx
  on idempotency_requests(channel_id)
  where request_scope = 'session-call' and status = 'pending' and channel_id is not null;

alter table session_channels enable row level security;
drop policy if exists "open" on session_channels;
create policy "open" on session_channels for all using (true);

alter table idempotency_requests enable row level security;
drop policy if exists "open" on idempotency_requests;
create policy "open" on idempotency_requests for all using (true);

update agent_wallets
set
  wallet_type = case
    when circle_wallet_id is not null then 'circle'
    else coalesce(wallet_type, 'eoa')
  end,
  custody_provider = case
    when circle_wallet_id is not null then 'circle'
    else coalesce(custody_provider, 'self')
  end,
  gateway_enabled = case
    when circle_wallet_id is not null then true
    else coalesce(gateway_enabled, false)
  end,
  status = coalesce(status, 'active'),
  default_asset = coalesce(default_asset, 'USDC'),
  default_network = coalesce(default_network, 'ARC-TESTNET'),
  metadata = coalesce(metadata, '{}'::jsonb);
