/**
 * KosRadar — Types untuk modul radar ingestion & AI parser.
 */

import type { PricePeriod } from "./pricing";
import type { DealGrade, DealRiskFlag } from "./valuation";

/** Tipe properti sesuai DB enum. */
export type PropertyType = "kos_putra" | "kos_putri" | "kos_campur" | "oper_kontrak";

/** Platform sumber sesuai DB enum. */
export type SourcePlatform =
  | "facebook_group"
  | "x_menfess"
  | "telegram"
  | "rss"
  | "web_public"
  | "manual_webhook";

/** Payload mentah dari scraper / Hermes Agent. */
export interface RawPost {
  raw_text: string;
  image_urls?: string[];
  source_url?: string;
  city_slug: string;
  platform?: SourcePlatform;
}

/** Hasil pre-filter. */
export interface PrefilterResult {
  passed: boolean;
  reason?: "no_keyword" | "spam" | "too_short" | "duplicate" | "non_listing";
  cleaned_text?: string;
  source_hash?: string;
  contact_hint?: string; // nomor yang ditemukan di teks
}

/** Output terstruktur dari AI parser. */
export interface ParsedListing {
  title: string;
  price_monthly: number | null;
  property_type: PropertyType | null;
  area_tag: string | null;
  facilities: string[];
  contact_wa: string | null;
  is_undervalued: boolean;
  ai_summary: string;
  /** Sinyal harga tambahan untuk valuasi pasar. */
  price_raw?: string | null;
  price_period?: PricePeriod | null;
  price_total?: number | null;
  deposit_idr?: number | null;
  room_size_m2?: number | null;
  is_negotiable?: boolean;
}

/** Listing siap insert ke DB. */
export interface ListingInsert {
  city_id: number;
  source_hash: string;
  raw_text: string;
  title: string | null;
  price_monthly: number | null;
  property_type: PropertyType | null;
  area_tag: string | null;
  facilities: string[];
  image_urls: string[];
  source_url: string | null;
  contact_wa: string | null;
  is_undervalued: boolean;
  ai_summary: string | null;
  posted_at?: string;
  price_raw?: string | null;
  price_period?: PricePeriod | null;
  price_total?: number | null;
  deposit_idr?: number | null;
  room_size_m2?: number | null;
  is_negotiable?: boolean;
  /** Hasil mesin valuasi (opsional; kolom DB bisa belum dimigrasi). */
  market_value?: number | null;
  discount_pct?: number | null;
  deal_score?: number | null;
  deal_confidence?: number | null;
  deal_grade?: DealGrade | null;
  deal_reasons?: string[];
  risk_flags?: DealRiskFlag[];
  sample_size?: number | null;
  valuation?: Record<string, unknown>;
}

/** Payload untuk endpoint ingest (cron + webhook). */
export interface IngestPayload {
  posts: RawPost[];
  /** Secret header atau query param untuk autentikasi cron/webhook. */
}

/** Hasil ingestion per post. */
export interface IngestResult {
  source_hash: string;
  status: "inserted" | "duplicate" | "filtered" | "parse_error";
  reason?: string;
}
