-- =============================================================================
-- KosRadar — Pipeline overhaul: field akurasi harga & detail
-- Idempotent.
-- =============================================================================

alter table listings add column if not exists gender_type          text;
alter table listings add column if not exists listing_type         text;
alter table listings add column if not exists billing_cycle        text;
alter table listings add column if not exists electricity_included boolean not null default false;
alter table listings add column if not exists campus_proximity     text;
alter table listings add column if not exists clean_summary        text;
alter table listings add column if not exists price_yearly         integer;
alter table listings add column if not exists takeover_price       integer;
alter table listings add column if not exists remaining_months     smallint;
