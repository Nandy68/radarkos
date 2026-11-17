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

-- Seed Sample Verified Listings
insert into listings (
  city_id, source_hash, raw_text, title, price_monthly, property_type,
  area_tag, facilities, image_urls, source_url, contact_wa, is_undervalued, ai_summary, posted_at
)
select 
  c.id,
  'seed-pwt-1',
  'Kos Putri Pondok Melati Grendeng Unsoed KM Dalam WiFi Rp650rb WA 081226849012',
  'Kos Putri Pondok Melati — 3 Menit Jalan Kaki ke FISIP & FH Unsoed',
  650000,
  'kos_putri',
  'Grendeng (± 300m ke Kampus 1 Unsoed)',
  '["KM Dalam", "WiFi 50Mbps", "Kasur Springbed", "Lemari 2 Pintu", "Listrik Token Mandiri"]'::jsonb,
  '["https://images.unsplash.com/photo-1522771739844-6a9f6d5f14af?auto=format&fit=crop&w=1000&q=80", "https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&w=1000&q=80"]'::jsonb,
  'https://facebook.com/groups/infokospurwokerto/permalink/894120391023/',
  '6281226849012',
  true,
  'Kamar sejuk dengan ventilasi bagus di gang tenang Grendeng. Harga di bawah pasaran rata-rata area kampus (normal Rp750rb - Rp850rb).',
  now() - interval '9 minutes'
from cities c where c.slug = 'purwokerto'
on conflict (source_hash) do nothing;

insert into listings (
  city_id, source_hash, raw_text, title, price_monthly, property_type,
  area_tag, facilities, image_urls, source_url, contact_wa, is_undervalued, ai_summary, posted_at
)
select 
  c.id,
  'seed-pwt-2',
  'Oper Kontrak Karangwangkal dekat Biologi sisa 5 bulan 2.4jt WA 085747891234',
  'Oper Kontrak Kos Putra Karangwangkal — Sisa 5 Bulan Rp2,4jt (Rp480rb/bln)',
  480000,
  'oper_kontrak',
  'Karangwangkal (Dekat Biologi & Faperta)',
  '["Parkir Motor Luas", "Kasur Busa Inoac", "Meja Belajar", "WiFi", "Dapur Bersama", "Bebas Jam Malam"]'::jsonb,
  '["https://images.unsplash.com/photo-1598928506311-c55ded91a20c?auto=format&fit=crop&w=1000&q=80"]'::jsonb,
  'https://t.me/infokospurwokerto/4821',
  '6285747891234',
  true,
  'Takeover kamar oper kontrak karena mahasiswa pindah magang. Sewa normal Rp650rb/bln, dilepas borongan sisa 5 bulan diskon 25%.',
  now() - interval '24 minutes'
from cities c where c.slug = 'purwokerto'
on conflict (source_hash) do nothing;

insert into listings (
  city_id, source_hash, raw_text, title, price_monthly, property_type,
  area_tag, facilities, image_urls, source_url, contact_wa, is_undervalued, ai_summary, posted_at
)
select 
  c.id,
  'seed-yog-1',
  'Kos Putri Pogung Kidul 4 mnt ke Pascasarjana UGM KM Dalam 950rb WA 081227890123',
  'Kos Putri Pogung Kidul — 4 Menit Jalan Kaki ke Gedung Pascasarjana & FT UGM',
  950000,
  'kos_putri',
  'Pogung Kidul (± 400m ke UGM)',
  '["KM Dalam", "WiFi Indihome 100M", "Kasur Busa Tebal", "Meja Belajar Kayu", "Parkir Motor Aman"]'::jsonb,
  '["https://images.unsplash.com/photo-1522771739844-6a9f6d5f14af?auto=format&fit=crop&w=1000&q=80", "https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&w=1000&q=80"]'::jsonb,
  'https://x.com/ugm_fess/status/179234810293',
  '6281227890123',
  true,
  'Lokasi emas mahasiswa UGM Pogung Kidul. Sangat jarang ada kamar kosong di bawah Rp1,1jt di ring 1 UGM.',
  now() - interval '8 minutes'
from cities c where c.slug = 'yogyakarta'
on conflict (source_hash) do nothing;

insert into listings (
  city_id, source_hash, raw_text, title, price_monthly, property_type,
  area_tag, facilities, image_urls, source_url, contact_wa, is_undervalued, ai_summary, posted_at
)
select 
  c.id,
  'seed-yog-2',
  'Oper Kontrak Seturan UPN AC KM Dalam 700rb sisa 6 bln WA 085876543210',
  'Oper Kontrak Kos Putra Seturan Dekat UPN & YKPN — Sisa 6 Bulan Rp700rb/bln',
  700000,
  'oper_kontrak',
  'Seturan (± 3 mnt ke UPN Veteran & YKPN)',
  '["AC", "KM Dalam", "WiFi Cepat", "Kasur Springbed", "Bebas Jam Malam"]'::jsonb,
  '["https://images.unsplash.com/photo-1598928506311-c55ded91a20c?auto=format&fit=crop&w=1000&q=80"]'::jsonb,
  'https://facebook.com/groups/infokosjogjamurah/permalink/102938471/',
  '6285876543210',
  true,
  'Oper kontrak karena exchange ke luar negeri. Fasilitas AC & KM Dalam harga normal Rp1,1jt, dioper hanya Rp700rb/bln.',
  now() - interval '18 minutes'
from cities c where c.slug = 'yogyakarta'
on conflict (source_hash) do nothing;

