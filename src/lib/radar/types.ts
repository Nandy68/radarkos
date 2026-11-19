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
  | "manual_webhook"
  | "instagram"
  | "instagram_story"
  | "facebook_page"
  | "tiktok";

/** Payload mentah dari scraper / Hermes Agent. */
export interface RawPost {
  raw_text: string;
  image_urls?: string[];
  source_url?: string;
  city_slug: string;
  platform?: SourcePlatform;
  /** @akun, nama grup, atau domain sumber. */
  source_name?: string;
  /** Timestamp asli postingan di sumber. */
  posted_at_source?: string;
  /** Teks mentah tanpa markup, aman untuk ditampilkan setelah disanitasi. */
  caption?: string;
  address_hint?: string;
  extra?: Record<string, unknown>;
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
  /** Detail tambahan (opsional agar konstruktor lama tetap valid). */
  address_detail?: string | null;
  maps_url?: string | null;
  landlord_name?: string | null;
  landlord_type?: "pemilik" | "penyewa" | "agen" | null;
  bathroom_type?: "dalam" | "luar" | null;
  electricity?: "token" | "termasuk" | "terpisah" | null;
  water?: "termasuk" | "pdam" | "sumur" | null;
  min_stay_months?: number | null;
  available_from?: string | null;
  rules?: Record<string, boolean> | null;
  nearby_landmarks?: string[] | null;
  /** Field akurasi harga & detail (pipeline overhaul). */
  gender_type?: "Putra" | "Putri" | "Campur" | null;
  listing_type?: "Kos Baru" | "Oper Kontrak" | null;
  billing_cycle?: "Bulanan" | "3 Bulanan" | "Tahunan" | "Sisa Kontrak" | null;
  electricity_included?: boolean;
  campus_proximity?: string | null;
  clean_summary?: string | null;
  price_yearly?: number | null;
  takeover_price?: number | null;
  remaining_months?: number | null;
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
  source_platform?: SourcePlatform | null;
  source_name?: string | null;
  posted_at_source?: string | null;
  caption?: string | null;
  address_detail?: string | null;
  maps_url?: string | null;
  landlord_name?: string | null;
  landlord_type?: string | null;
  bathroom_type?: string | null;
  electricity?: string | null;
  water?: string | null;
  min_stay_months?: number | null;
  available_from?: string | null;
  rules?: Record<string, boolean> | null;
  nearby_landmarks?: string[] | null;
  gender_type?: string | null;
  listing_type?: string | null;
  billing_cycle?: string | null;
  electricity_included?: boolean;
  campus_proximity?: string | null;
  clean_summary?: string | null;
  price_yearly?: number | null;
  takeover_price?: number | null;
  remaining_months?: number | null;
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
