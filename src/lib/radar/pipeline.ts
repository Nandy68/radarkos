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

import type OpenAI from "openai";
import { prefilter } from "./prefilter";
import {
  needsAiEnrichment,
  parseHeuristic,
  parseListing,
  parseListingBatch,
} from "./parser";
import { getAiLimits } from "./limits";
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

    source_platform: post.platform ?? null,
    source_name: post.source_name ?? null,
    posted_at_source: post.posted_at_source ?? null,
    caption: post.caption ?? post.raw_text,
    address_detail: parsed.address_detail ?? null,
    maps_url: parsed.maps_url ?? null,
    landlord_name: parsed.landlord_name ?? null,
    landlord_type: parsed.landlord_type ?? null,
    bathroom_type: parsed.bathroom_type ?? null,
    electricity: parsed.electricity ?? null,
    water: parsed.water ?? null,
    min_stay_months: parsed.min_stay_months ?? null,
    available_from: parsed.available_from ?? null,
    rules: parsed.rules ?? {},
    nearby_landmarks: parsed.nearby_landmarks ?? [],
    gender_type: parsed.gender_type ?? null,
    listing_type: parsed.listing_type ?? null,
    billing_cycle: parsed.billing_cycle ?? null,
    electricity_included: parsed.electricity_included ?? false,
    campus_proximity: parsed.campus_proximity ?? null,
    clean_summary: parsed.clean_summary ?? null,
    price_yearly: parsed.price_yearly ?? null,
    takeover_price: parsed.takeover_price ?? null,
    remaining_months: parsed.remaining_months ?? null,

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

interface PreparedContext {
  post: RawPost;
  sourceHash: string;
  city: { id: number; name: string };
  cleanedText: string;
  comparables: DealCandidate[];
}

type PreparedResult = { early: IngestResult } | { ctx: PreparedContext };

type EnrichedContext = PreparedContext & { parsed: ParsedListing };

/**
 * Tahap prepare: filter, dedup, resolve kota, dan ambil pembanding pasar.
 */
async function prepareRawPost(
  supabase: DbClient,
  post: RawPost,
  comparableCache?: Map<number, DealCandidate[]>
): Promise<PreparedResult> {
  if (!post.raw_text || !post.city_slug) {
    return {
      early: {
        source_hash: "",
        status: "filtered",
        reason: "Missing raw_text or city_slug",
      },
    };
  }

  const filterResult = await prefilter(post.raw_text);
  if (!filterResult.passed) {
    return {
      early: {
        source_hash: filterResult.source_hash ?? "",
        status: "filtered",
        reason: filterResult.reason,
      },
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
    return { early: { source_hash: sourceHash, status: "duplicate" } };
  }

  const { data: city } = await supabase
    .from("cities")
    .select("id, name")
    .eq("slug", post.city_slug)
    .eq("is_active", true)
    .single();

  if (!city) {
    return {
      early: {
        source_hash: sourceHash,
        status: "filtered",
        reason: `City '${post.city_slug}' not found`,
      },
    };
  }

  let comparables = comparableCache?.get(city.id);
  if (!comparables) {
    comparables = await fetchComparables(supabase, city.id);
    comparableCache?.set(city.id, comparables);
  }

  return {
    ctx: {
      post,
      sourceHash,
      city,
      cleanedText: filterResult.cleaned_text!,
      comparables,
    },
  };
}

/**
 * Tahap persist: quality gate, valuasi, insert, dan radar alert.
 */
async function persistCandidate(
  supabase: DbClient,
  ctx: PreparedContext,
  parsed: ParsedListing
): Promise<IngestResult> {
  const prepared = prepareCandidate(
    ctx.cleanedText,
    parsed,
    ctx.post,
    ctx.sourceHash,
    ctx.comparables
  );

  // Quality Gate: Tolak postingan tanpa harga dan tanpa fasilitas/kontak
  const effectiveMonthly = prepared.signal.monthly ?? parsed.price_monthly;
  if (!effectiveMonthly && parsed.facilities.length === 0 && !parsed.contact_wa) {
    return {
      source_hash: ctx.sourceHash,
      status: "filtered",
      reason: "Listing tidak memiliki harga sewa, fasilitas, maupun kontak yang jelas",
    };
  }

  const listing = buildListingRow(
    ctx.city.id,
    ctx.sourceHash,
    ctx.post,
    ctx.cleanedText,
    parsed,
    prepared
  );

  const { error: insertErr } = await insertResilient(supabase, listing);

  if (insertErr) {
    if (insertErr.code === "23505") {
      return { source_hash: ctx.sourceHash, status: "duplicate" };
    }
    return {
      source_hash: ctx.sourceHash,
      status: "parse_error",
      reason: `DB insert error: ${insertErr.message}`,
    };
  }

  // Listing baru ikut menjadi pembanding untuk post berikutnya di batch ini.
  ctx.comparables.unshift({
    id: `incoming-${ctx.sourceHash}`,
    title: parsed.title,
    price_monthly: listing.price_monthly as number | null,
    property_type: parsed.property_type,
    area_tag: parsed.area_tag,
    facilities: parsed.facilities,
    posted_at: listing.posted_at as string,
    image_urls: ctx.post.image_urls ?? [],
    source_url: ctx.post.source_url ?? null,
    contact_wa: parsed.contact_wa,
    ai_summary: parsed.ai_summary,
    room_size_m2: prepared.roomSizeM2,
    price_confidence: prepared.signal.confidence,
  });

  try {
    await dispatchRadarAlert(listing, supabase, ctx.city.name);
  } catch (err) {
    // Listing sudah tersimpan; kegagalan notifikasi tidak boleh membuat
    // ingestion dianggap gagal (dan memicu insert duplikat saat retry).
    console.error("[ingest] Radar alert dispatch failed:", err);
  }

  return { source_hash: ctx.sourceHash, status: "inserted" };
}

/**
 * Proses satu post mentah. Diekspor untuk pengujian integrasi.
 */
export async function processRawPost(
  supabase: DbClient,
  post: RawPost,
  comparableCache?: Map<number, DealCandidate[]>
): Promise<IngestResult> {
  const prepared = await prepareRawPost(supabase, post, comparableCache);
  if ("early" in prepared) return prepared.early;

  const ctx = prepared.ctx;
  const parsed = await parseListing(ctx.cleanedText);
  if (!parsed) {
    return {
      source_hash: ctx.sourceHash,
      status: "parse_error",
      reason: "Parsing failed",
    };
  }

  return persistCandidate(supabase, ctx, parsed);
}

export interface IngestStats {
  total: number;
  inserted: number;
  duplicate: number;
  filtered: number;
  parse_error: number;
  ai_calls: number;
  ai_posts: number;
  prompt_tokens: number;
  completion_tokens: number;
}

/**
 * Proses batch: prepare → batch enrich (hanya post bolong) → persist.
 */
export async function ingestPosts(
  supabase: DbClient,
  posts: RawPost[],
  options?: { client?: OpenAI }
): Promise<{ results: IngestResult[]; stats: IngestStats }> {
  const comparableCache = new Map<number, DealCandidate[]>();
  const results: (IngestResult | null)[] = new Array(posts.length).fill(null);
  const contexts: EnrichedContext[] = [];
  const slots: number[] = [];

  for (let index = 0; index < posts.length; index += 1) {
    const prepared = await prepareRawPost(supabase, posts[index], comparableCache);
    if ("early" in prepared) {
      results[index] = prepared.early;
      continue;
    }

    const parsed = parseHeuristic(prepared.ctx.cleanedText);
    if (!parsed) {
      results[index] = {
        source_hash: prepared.ctx.sourceHash,
        status: "parse_error",
        reason: "Parsing failed",
      };
      continue;
    }

    contexts.push({ ...prepared.ctx, parsed });
    slots.push(index);
  }

  const limits = getAiLimits();
  const aiAvailable = Boolean(options?.client || process.env.DEEPSEEK_API_KEY);
  const candidates: number[] = [];

  if (aiAvailable) {
    for (let index = 0; index < contexts.length; index += 1) {
      if (candidates.length >= limits.maxPostsPerRun) break;
      if (needsAiEnrichment(contexts[index].parsed)) candidates.push(index);
    }
  }

  let aiCalls = 0;
  let aiPosts = 0;
  let promptTokens = 0;
  let completionTokens = 0;

  for (
    let start = 0;
    start < candidates.length && aiCalls < limits.maxCallsPerRun;
    start += limits.batchSize
  ) {
    const chunk = candidates.slice(start, start + limits.batchSize);
    const output = await parseListingBatch(
      chunk.map((index) => contexts[index].cleanedText),
      { client: options?.client }
    );

    aiCalls += 1;
    aiPosts += chunk.length;

    if (output.usage) {
      promptTokens += output.usage.prompt_tokens;
      completionTokens += output.usage.completion_tokens;
    }

    output.items.forEach((item, position) => {
      if (item) contexts[chunk[position]].parsed = item;
    });
  }

  for (let index = 0; index < contexts.length; index += 1) {
    results[slots[index]] = await persistCandidate(
      supabase,
      contexts[index],
      contexts[index].parsed
    );
  }

  const finished = results as IngestResult[];

  return {
    results: finished,
    stats: {
      total: finished.length,
      inserted: finished.filter((result) => result.status === "inserted").length,
      duplicate: finished.filter((result) => result.status === "duplicate").length,
      filtered: finished.filter((result) => result.status === "filtered").length,
      parse_error: finished.filter((result) => result.status === "parse_error").length,
      ai_calls: aiCalls,
      ai_posts: aiPosts,
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
    },
  };
}
