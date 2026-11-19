-- =============================================================================
-- KosRadar — Supabase (PostgreSQL) schema
-- Jalankan di Supabase SQL Editor atau `supabase db push`.
-- Idempotent sebisa mungkin: aman dijalankan ulang di database kosong.
-- =============================================================================

create extension if not exists pgcrypto;  -- gen_random_uuid(), digest()

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------
do $$ begin
  create type source_platform as enum (
    'facebook_group',   -- hanya halaman/grup publik, tanpa login (lihat PRD §7)
    'x_menfess',
    'telegram',         -- channel publik
    'rss',              -- feed RSS/Atom publik
    'web_public',       -- halaman web publik / API terbuka
    'manual_webhook'    -- ingestion manual atau agen lokal via webhook
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type property_type as enum ('kos_putra', 'kos_putri', 'kos_campur', 'oper_kontrak');
exception when duplicate_object then null; end $$;

do $$ begin
  create type subscription_status as enum ('pending', 'active', 'expired');
exception when duplicate_object then null; end $$;

-- -----------------------------------------------------------------------------
-- cities
-- -----------------------------------------------------------------------------
create table if not exists cities (
  id         smallint generated always as identity primary key,
  name       text    not null,
  slug       text    not null unique check (slug ~ '^[a-z0-9-]+$'),
  is_active  boolean not null default true
);

-- -----------------------------------------------------------------------------
-- sources
-- -----------------------------------------------------------------------------
create table if not exists sources (
  id               bigint generated always as identity primary key,
  city_id          smallint        not null references cities(id) on delete cascade,
  platform         source_platform not null,
  url              text            not null,
  last_scraped_at  timestamptz,
  unique (city_id, url)
);

create index if not exists sources_city_idx           on sources (city_id);
create index if not exists sources_last_scraped_idx   on sources (last_scraped_at nulls first);

-- -----------------------------------------------------------------------------
-- listings
-- -----------------------------------------------------------------------------
create table if not exists listings (
  id              bigint generated always as identity primary key,
  city_id         smallint      not null references cities(id) on delete cascade,
  source_hash     text          not null unique,   -- sha256(platform|url|normalized_text), dedup
  raw_text        text          not null,
  title           text,
  price_monthly   integer       check (price_monthly is null or price_monthly between 0 and 100000000),
  property_type   property_type,
  area_tag        text,
  facilities      jsonb         not null default '[]'::jsonb check (jsonb_typeof(facilities) = 'array'),
  image_urls      jsonb         not null default '[]'::jsonb check (jsonb_typeof(image_urls) = 'array'),
  source_url      text,
  contact_wa      text          check (contact_wa is null or contact_wa ~ '^62[0-9]{8,13}$'),
  is_undervalued  boolean       not null default false,
  ai_summary      text,
  posted_at       timestamptz   not null default now(),
  created_at      timestamptz   not null default now()
);

create index if not exists listings_city_posted_idx
  on listings (city_id, posted_at desc);
create index if not exists listings_city_type_price_idx
  on listings (city_id, property_type, price_monthly);
create index if not exists listings_city_area_idx
  on listings (city_id, area_tag);
create index if not exists listings_undervalued_idx
  on listings (city_id, posted_at desc) where is_undervalued;
create index if not exists listings_facilities_gin
  on listings using gin (facilities jsonb_path_ops);
create index if not exists listings_created_idx
  on listings (created_at);

-- -----------------------------------------------------------------------------
-- Deal Valuation Engine
-- Kolom ini menyimpan hasil audit valuasi agar skor bisa dianalisis ulang.
-- ALTER ... IF NOT EXISTS menjaga schema tetap idempotent untuk DB lama.
-- -----------------------------------------------------------------------------
alter table listings add column if not exists price_raw      text;
alter table listings add column if not exists price_period   text;
alter table listings add column if not exists price_total    integer;
alter table listings add column if not exists deposit_idr    integer;
alter table listings add column if not exists room_size_m2   numeric(5,1);
alter table listings add column if not exists is_negotiable  boolean not null default false;
alter table listings add column if not exists market_value   integer;
alter table listings add column if not exists discount_pct   numeric(8,1);
alter table listings add column if not exists deal_score     smallint;
alter table listings add column if not exists deal_confidence numeric(4,3);
alter table listings add column if not exists deal_grade     text;
alter table listings add column if not exists deal_reasons   jsonb not null default '[]'::jsonb;
alter table listings add column if not exists risk_flags     jsonb not null default '[]'::jsonb;
alter table listings add column if not exists sample_size    smallint;
alter table listings add column if not exists valuation      jsonb not null default '{}'::jsonb;

create index if not exists listings_city_deal_score_idx
  on listings (city_id, deal_score desc nulls last)
  where is_undervalued;

-- -----------------------------------------------------------------------------
-- Detail listing & state sumber (multi-platform Fase 0)
-- -----------------------------------------------------------------------------
alter type source_platform add value if not exists 'instagram';
alter type source_platform add value if not exists 'instagram_story';
alter type source_platform add value if not exists 'facebook_page';
alter type source_platform add value if not exists 'tiktok';

alter table listings add column if not exists source_platform      text;
alter table listings add column if not exists source_name          text;
alter table listings add column if not exists address_detail       text;
alter table listings add column if not exists maps_url             text;
alter table listings add column if not exists landlord_name        text;
alter table listings add column if not exists landlord_type        text;
alter table listings add column if not exists bathroom_type        text;
alter table listings add column if not exists electricity          text;
alter table listings add column if not exists water                text;
alter table listings add column if not exists min_stay_months      smallint;
alter table listings add column if not exists available_from       date;
alter table listings add column if not exists rules                jsonb not null default '{}'::jsonb;
alter table listings add column if not exists nearby_landmarks     jsonb not null default '[]'::jsonb;
alter table listings add column if not exists posted_at_source     timestamptz;
alter table listings add column if not exists detail_confidence    numeric(4,3);
alter table listings add column if not exists caption              text;

create index if not exists listings_source_platform_idx
  on listings (source_platform);

alter table sources add column if not exists source_key    text;
alter table sources add column if not exists cursor        jsonb not null default '{}'::jsonb;
alter table sources add column if not exists is_enabled    boolean not null default true;
alter table sources add column if not exists last_status   text;
alter table sources add column if not exists last_error    text;

create unique index if not exists sources_source_key_key on sources (source_key);

-- -----------------------------------------------------------------------------
-- Field akurasi harga & detail (pipeline overhaul)
-- -----------------------------------------------------------------------------
alter table listings add column if not exists gender_type          text;
alter table listings add column if not exists listing_type         text;
alter table listings add column if not exists billing_cycle        text;
alter table listings add column if not exists electricity_included boolean not null default false;
alter table listings add column if not exists campus_proximity     text;
alter table listings add column if not exists clean_summary        text;
alter table listings add column if not exists price_yearly         integer;
alter table listings add column if not exists takeover_price       integer;
alter table listings add column if not exists remaining_months     smallint;

-- -----------------------------------------------------------------------------
-- subscriptions
-- Satu baris = satu pembelian Rp10.000 untuk 1 kota selama 14 hari.
-- Token disimpan sebagai hash SHA-256 (hex).
-- -----------------------------------------------------------------------------
create table if not exists subscriptions (
  id                  uuid primary key default gen_random_uuid(),
  user_wa             text                not null check (user_wa ~ '^62[0-9]{8,13}$'),
  city_id             smallint            not null references cities(id),
  alert_criteria      jsonb               not null default '{}'::jsonb
                        check (jsonb_typeof(alert_criteria) = 'object'),
  status              subscription_status not null default 'pending',
  expires_at          timestamptz,        -- diisi saat settlement: now() + 14 hari
  midtrans_order_id   text                not null unique,
  gross_amount        integer             not null default 10000 check (gross_amount > 0),
  access_token_hash   text                unique,  -- token klaim / session (?token=...)
  claim_nonce_hash    text,               -- mengikat browser checkout ke order (cookie pending)
  paid_at             timestamptz,
  created_at          timestamptz         not null default now(),
  check (status <> 'active' or expires_at is not null)
);

create index if not exists subscriptions_wa_city_idx
  on subscriptions (user_wa, city_id, expires_at desc);
create index if not exists subscriptions_active_city_idx
  on subscriptions (city_id, expires_at) where status = 'active';
create index if not exists subscriptions_expiry_idx
  on subscriptions (expires_at) where status = 'active';

-- -----------------------------------------------------------------------------
-- subscription_devices
-- Sesi device per langganan. Maksimal 2 device aktif per token.
-- -----------------------------------------------------------------------------
create table if not exists subscription_devices (
  id                 uuid primary key default gen_random_uuid(),
  subscription_id    uuid        not null references subscriptions(id) on delete cascade,
  device_token_hash  text        not null unique,
  user_agent         text,
  created_at         timestamptz not null default now(),
  last_seen_at       timestamptz not null default now(),
  revoked_at         timestamptz
);

create index if not exists subscription_devices_active_idx
  on subscription_devices (subscription_id) where revoked_at is null;

create or replace function enforce_device_limit() returns trigger
language plpgsql as $$
declare
  active_count integer;
begin
  perform 1 from subscriptions where id = new.subscription_id for update;

  select count(*) into active_count
  from subscription_devices
  where subscription_id = new.subscription_id
    and revoked_at is null;

  if active_count >= 2 then
    raise exception 'DEVICE_LIMIT_REACHED' using errcode = 'P0001';
  end if;

  return new;
end $$;

drop trigger if exists subscription_devices_limit on subscription_devices;
create trigger subscription_devices_limit
  before insert on subscription_devices
  for each row execute function enforce_device_limit();

-- -----------------------------------------------------------------------------
-- Aktivasi langganan: atomik & idempoten saat Midtrans settlement.
-- -----------------------------------------------------------------------------
create or replace function activate_subscription(
  p_order_id text
) returns subscriptions
language plpgsql as $$
declare
  sub subscriptions;
begin
  update subscriptions
     set status     = 'active',
         paid_at    = now(),
         expires_at = now() + interval '14 days'
   where midtrans_order_id = p_order_id
     and status = 'pending'
  returning * into sub;

  if not found then
    select * into sub from subscriptions where midtrans_order_id = p_order_id;
    return sub;
  end if;

  return sub;
end $$;

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
alter table cities               enable row level security;
alter table sources              enable row level security;
alter table listings             enable row level security;
alter table subscriptions        enable row level security;
alter table subscription_devices enable row level security;

drop policy if exists cities_public_read on cities;
create policy cities_public_read on cities
  for select to anon, authenticated using (is_active);

revoke execute on function activate_subscription(text) from public, anon, authenticated;
revoke execute on function enforce_device_limit()      from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Seed
-- -----------------------------------------------------------------------------
insert into cities (name, slug) values
  ('Purwokerto', 'purwokerto'),
  ('Yogyakarta', 'yogyakarta'),
  ('Malang',     'malang'),
  ('Bandung',    'bandung'),
  ('Semarang',   'semarang'),
  ('Solo',       'solo')
on conflict (slug) do nothing;

-- -----------------------------------------------------------------------------
-- Seed Sources for Scraper & Ingestion Cron
-- -----------------------------------------------------------------------------
insert into sources (city_id, platform, url)
select c.id, 'facebook_group', 'https://www.facebook.com/groups/infokospurwokertoo/'
from cities c where c.slug = 'purwokerto'
on conflict (city_id, url) do nothing;

insert into sources (city_id, platform, url)
select c.id, 'x_menfess', 'https://x.com/unsoedfess'
from cities c where c.slug = 'purwokerto'
on conflict (city_id, url) do nothing;

insert into sources (city_id, platform, url)
select c.id, 'telegram', 'https://t.me/infokospurwokerto'
from cities c where c.slug = 'purwokerto'
on conflict (city_id, url) do nothing;

insert into sources (city_id, platform, url)
select c.id, 'facebook_group', 'https://www.facebook.com/groups/infokosjogjaterbaru/'
from cities c where c.slug = 'yogyakarta'
on conflict (city_id, url) do nothing;

insert into sources (city_id, platform, url)
select c.id, 'x_menfess', 'https://x.com/ugm_fess'
from cities c where c.slug = 'yogyakarta'
on conflict (city_id, url) do nothing;

insert into sources (city_id, platform, url)
select c.id, 'telegram', 'https://t.me/kosjogjaupdate'
from cities c where c.slug = 'yogyakarta'
on conflict (city_id, url) do nothing;

insert into sources (city_id, platform, url)
select c.id, 'facebook_group', 'https://www.facebook.com/groups/kosmalangraya/'
from cities c where c.slug = 'malang'
on conflict (city_id, url) do nothing;

insert into sources (city_id, platform, url)
select c.id, 'x_menfess', 'https://x.com/ub_menfess'
from cities c where c.slug = 'malang'
on conflict (city_id, url) do nothing;

insert into sources (city_id, platform, url)
select c.id, 'facebook_group', 'https://www.facebook.com/groups/kossemarang/'
from cities c where c.slug = 'semarang'
on conflict (city_id, url) do nothing;

insert into sources (city_id, platform, url)
select c.id, 'x_menfess', 'https://x.com/undipmenfess'
from cities c where c.slug = 'semarang'
on conflict (city_id, url) do nothing;

insert into sources (city_id, platform, url)
select c.id, 'facebook_group', 'https://www.facebook.com/groups/kossolo/'
from cities c where c.slug = 'solo'
on conflict (city_id, url) do nothing;

insert into sources (city_id, platform, url)
select c.id, 'x_menfess', 'https://x.com/uns_fess'
from cities c where c.slug = 'solo'
on conflict (city_id, url) do nothing;


