/**
 * KosRadar — Ingestion Pipeline
 *
 * Satu jalur pemrosesan untuk cron maupun webhook:
 * prefilter → dedup → resolve kota → ekstraksi AI/heuristik
 * → rekonsiliasi harga → valuasi pasar → insert → radar alert.
 *
 * Modul ini sengaja tidak mengimpor tipe Supabase agar mudah diuji dan
 * tetap kompatibel dengan klien admin yang dipakai route handler.
 */

import { prefilter } from "./prefilter";
import { parseListing } from "./parser";
import { extractPriceSignal, extractRoomSizeM2, type PriceSignal } from "./pricing";
import {
  evaluateDeal,
  type DealCandidate,
  type DealValuation,
} from "./valuation";
import { dispatchRadarAlert } from "./notifier";
import type { IngestResult, ListingInsert, ParsedListing, RawPost } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbClient = { from: (table: string) => any };

const COMPARABLE_LOOKBACK_DAYS = 365;
const COMPARABLE_LIMIT = 400;

const COMPARABLE_SELECT =
  "id, title, price_monthly, property_type, area_tag, facilities, posted_at, image_urls, source_url, contact_wa, ai_summary";

interface PreparedCandidate {
  signal: PriceSignal;
  roomSizeM2: number | null;
  candidate: DealCandidate;
  valuation: DealValuation;
}

function isMissingColumnError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  if (error.code === "42703" || error.code === "PGRST204") return true;
  return /column .* does not exist|could not find .* column|schema cache/i.test(
    error.message ?? ""
  );
}

function stripUndefined<T extends object>(row: T): T {
  return Object.fromEntries(
    Object.entries(row).filter(([, value]) => value !== undefined)
  ) as T;
}

async function fetchComparables(
  supabase: DbClient,
  cityId: number
): Promise<DealCandidate[]> {
  const cutoff = new Date(
    Date.now() - COMPARABLE_LOOKBACK_DAYS * 86_400_000
  ).toISOString();

  const { data, error } = await supabase
    .from("listings")
    .select(COMPARABLE_SELECT)
    .eq("city_id", cityId)
    .not("price_monthly", "is", null)
    .gte("posted_at", cutoff)
    .order("posted_at", { ascending: false })
    .limit(COMPARABLE_LIMIT);

  if (error || !data) return [];
  return data as DealCandidate[];
}

function prepareCandidate(
  cleanedText: string,
  parsed: ParsedListing,
  post: RawPost,
  sourceHash: string,
  comparables: DealCandidate[]
): PreparedCandidate {
  // Rekonsiliasi dua mesin ekstraksi: deterministik vs LLM.
  const signal = extractPriceSignal(cleanedText, {
    price_monthly: parsed.price_monthly,
    price_raw: parsed.price_raw,
    price_period: parsed.price_period,
    price_total: parsed.price_total,
    deposit_idr: parsed.deposit_idr,
  });

  const roomSizeM2 = parsed.room_size_m2 ?? extractRoomSizeM2(cleanedText);

  const candidate: DealCandidate = {
    id: `incoming-${sourceHash}`,
    title: parsed.title,
    price_monthly: signal.monthly,
    property_type: parsed.property_type,
    area_tag: parsed.area_tag,
    facilities: parsed.facilities,
    posted_at: new Date().toISOString(),
    room_size_m2: roomSizeM2,
    raw_text: cleanedText,
    ai_summary: parsed.ai_summary,
    image_urls: post.image_urls ?? [],
    source_url: post.source_url ?? null,
    contact_wa: parsed.contact_wa,
    price_confidence: signal.confidence,
  };

  const valuation = evaluateDeal(candidate, comparables);

  return { signal, roomSizeM2, candidate, valuation };
}

function buildListingRow(
  cityId: number,
  sourceHash: string,
  post: RawPost,
  cleanedText: string,
  parsed: ParsedListing,
  prepared: PreparedCandidate
): ListingInsert & Record<string, unknown> {
  const { signal, roomSizeM2, valuation } = prepared;

  return stripUndefined({
    city_id: cityId,
    source_hash: sourceHash,
    raw_text: cleanedText,
    title: parsed.title,
    price_monthly: signal.monthly ?? parsed.price_monthly,
    property_type: parsed.property_type,
    area_tag: parsed.area_tag,
    facilities: parsed.facilities,
    image_urls: post.image_urls ?? [],
    source_url: post.source_url ?? null,
    contact_wa: parsed.contact_wa,
    is_undervalued: valuation.is_undervalued,
    ai_summary: parsed.ai_summary,
    posted_at: new Date().toISOString(),

    price_raw: signal.raw,
    price_period: signal.period,
    price_total: parsed.price_total ?? null,
    deposit_idr: signal.deposit ?? parsed.deposit_idr ?? null,
    room_size_m2: roomSizeM2,
    is_negotiable: signal.negotiable || parsed.is_negotiable === true,

    market_value: valuation.fair_price_monthly,
    discount_pct:
      valuation.discount_pct == null
        ? null
        : Math.max(-9_999_999, Math.min(9_999_999, valuation.discount_pct)),
    deal_score: valuation.deal_score,
    deal_confidence: valuation.confidence,
    deal_grade: valuation.grade,
    deal_reasons: valuation.reasons,
    risk_flags: valuation.risk_flags,
    sample_size: valuation.sample_size,
    valuation: valuation as unknown as Record<string, unknown>,
  }) as ListingInsert & Record<string, unknown>;
}

async function insertResilient(
  supabase: DbClient,
  row: ListingInsert & Record<string, unknown>
) {
  let result = await supabase.from("listings").insert(row);

  if (result.error && isMissingColumnError(result.error)) {
    // Database lama belum punya kolom valuasi. Tetap simpan listing inti
    // agar feed tidak kehilangan data; skor dihitung ulang saat dibaca.
    console.warn(
      "[ingest] Kolom valuasi belum ada di DB; fallback ke insert dasar:",
      result.error.message
    );

    const basic: ListingInsert = {
      city_id: row.city_id as number,
      source_hash: row.source_hash as string,
      raw_text: row.raw_text as string,
      title: (row.title as string | null) ?? null,
      price_monthly: (row.price_monthly as number | null) ?? null,
      property_type: (row.property_type as ListingInsert["property_type"]) ?? null,
      area_tag: (row.area_tag as string | null) ?? null,
      facilities: row.facilities as string[],
      image_urls: row.image_urls as string[],
      source_url: (row.source_url as string | null) ?? null,
      contact_wa: (row.contact_wa as string | null) ?? null,
      is_undervalued: Boolean(row.is_undervalued),
      ai_summary: (row.ai_summary as string | null) ?? null,
      posted_at: row.posted_at as string | undefined,
    };

    result = await supabase.from("listings").insert(stripUndefined(basic));
  }

  return result as { error: { code?: string; message?: string } | null };
}

/**
 * Proses satu post mentah. Diekspor untuk pengujian integrasi.
 */
export async function processRawPost(
  supabase: DbClient,
  post: RawPost,
  comparableCache?: Map<number, DealCandidate[]>
): Promise<IngestResult> {
  if (!post.raw_text || !post.city_slug) {
    return {
      source_hash: "",
      status: "filtered",
      reason: "Missing raw_text or city_slug",
    };
  }

  const filterResult = await prefilter(post.raw_text);
  if (!filterResult.passed) {
    return {
      source_hash: filterResult.source_hash ?? "",
      status: "filtered",
      reason: filterResult.reason,
    };
  }

  const sourceHash = filterResult.source_hash!;

  const { data: existing } = await supabase
    .from("listings")
    .select("id")
    .eq("source_hash", sourceHash)
    .limit(1)
    .single();

  if (existing) {
    return { source_hash: sourceHash, status: "duplicate" };
  }

  const { data: city } = await supabase
    .from("cities")
    .select("id, name")
    .eq("slug", post.city_slug)
    .eq("is_active", true)
    .single();

  if (!city) {
    return {
      source_hash: sourceHash,
      status: "filtered",
      reason: `City '${post.city_slug}' not found`,
    };
  }

  const parsed = await parseListing(filterResult.cleaned_text!);
  if (!parsed) {
    return {
      source_hash: sourceHash,
      status: "parse_error",
      reason: "Parsing failed",
    };
  }

  let comparables = comparableCache?.get(city.id);
  if (!comparables) {
    comparables = await fetchComparables(supabase, city.id);
    comparableCache?.set(city.id, comparables);
  }

  const prepared = prepareCandidate(
    filterResult.cleaned_text!,
    parsed,
    post,
    sourceHash,
    comparables
  );

  // Quality Gate: Tolak postingan tanpa harga dan tanpa fasilitas/kontak
  const effectiveMonthly = prepared.signal.monthly ?? parsed.price_monthly;
  if (!effectiveMonthly && parsed.facilities.length === 0 && !parsed.contact_wa) {
    return {
      source_hash: sourceHash,
      status: "filtered",
      reason: "Listing tidak memiliki harga sewa, fasilitas, maupun kontak yang jelas",
    };
  }

  const listing = buildListingRow(
    city.id,
    sourceHash,
    post,
    filterResult.cleaned_text!,
    parsed,
    prepared
  );

  const { error: insertErr } = await insertResilient(supabase, listing);

  if (insertErr) {
    if (insertErr.code === "23505") {
      return { source_hash: sourceHash, status: "duplicate" };
    }
    return {
      source_hash: sourceHash,
      status: "parse_error",
      reason: `DB insert error: ${insertErr.message}`,
    };
  }

  // Listing baru ikut menjadi pembanding untuk post berikutnya di batch ini.
  if (comparableCache && comparables) {
    comparables.unshift({
      id: `incoming-${sourceHash}`,
      title: parsed.title,
      price_monthly: listing.price_monthly as number | null,
      property_type: parsed.property_type,
      area_tag: parsed.area_tag,
      facilities: parsed.facilities,
      posted_at: listing.posted_at as string,
      image_urls: post.image_urls ?? [],
      source_url: post.source_url ?? null,
      contact_wa: parsed.contact_wa,
      ai_summary: parsed.ai_summary,
      room_size_m2: prepared.roomSizeM2,
      price_confidence: prepared.signal.confidence,
    });
  }

  try {
    await dispatchRadarAlert(listing, supabase, city.name);
  } catch (err) {
    // Listing sudah tersimpan; kegagalan notifikasi tidak boleh membuat
    // ingestion dianggap gagal (dan memicu insert duplikat saat retry).
    console.error("[ingest] Radar alert dispatch failed:", err);
  }

  return { source_hash: sourceHash, status: "inserted" };
}

/**
 * Proses batch dengan cache pembanding per kota.
 */
export async function ingestPosts(
  supabase: DbClient,
  posts: RawPost[]
): Promise<{ results: IngestResult[]; stats: Record<string, number> }> {
  const comparableCache = new Map<number, DealCandidate[]>();
  const results: IngestResult[] = [];

  for (const post of posts) {
    results.push(await processRawPost(supabase, post, comparableCache));
  }

  return {
    results,
    stats: {
      total: results.length,
      inserted: results.filter((result) => result.status === "inserted").length,
      duplicate: results.filter((result) => result.status === "duplicate").length,
      filtered: results.filter((result) => result.status === "filtered").length,
      parse_error: results.filter((result) => result.status === "parse_error").length,
    },
  };
}
