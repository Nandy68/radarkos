-- =============================================================================
-- KosRadar — Multi-platform scraper Fase 0
-- Kolom detail listing + state sumber. Idempotent.
-- =============================================================================

-- Enum platform tambahan (dipakai sources.platform di fase berikutnya)
alter type source_platform add value if not exists 'instagram';
alter type source_platform add value if not exists 'instagram_story';
alter type source_platform add value if not exists 'facebook_page';
alter type source_platform add value if not exists 'tiktok';

-- Detail listing
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

-- State runtime sumber
alter table sources add column if not exists source_key    text;
alter table sources add column if not exists cursor        jsonb not null default '{}'::jsonb;
alter table sources add column if not exists is_enabled    boolean not null default true;
alter table sources add column if not exists last_status   text;
alter table sources add column if not exists last_error    text;

create unique index if not exists sources_source_key_key on sources (source_key);
