import { type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { prefilter } from "@/lib/radar/prefilter";
import { parseListing } from "@/lib/radar/parser";
import { dispatchRadarAlert } from "@/lib/radar/notifier";
import type {
  RawPost,
  IngestResult,
  ListingInsert,
} from "@/lib/radar/types";

const INGEST_SECRET = process.env.CRON_SECRET || process.env.INGEST_SECRET_KEY;

function isAuthorized(request: NextRequest): boolean {
  if (!INGEST_SECRET) return false;
  const headerKey = request.headers.get("x-ingest-key");
  const authHeader = request.headers.get("authorization");
  const bearerKey = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  return headerKey === INGEST_SECRET || bearerKey === INGEST_SECRET;
}

/**
 * POST /api/webhook/ingest
 *
 * Webhook endpoint untuk Hermes Agent (agen lokal di PC).
 * Menerima payload JSON tunggal atau batch dari scraper lokal.
 *
 * Auth: Header `Authorization: Bearer <CRON_SECRET>` atau `x-ingest-key`.
 *
 * Body: RawPost | { posts: RawPost[] }
 */
export async function POST(request: NextRequest) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  if (!isAuthorized(request)) {
    return Response.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  // ── Parse body ────────────────────────────────────────────────────────────
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  // Support single post atau batch
  let posts: RawPost[];
  if (Array.isArray(body.posts)) {
    posts = body.posts as RawPost[];
  } else if (body.raw_text && body.city_slug) {
    // Single post format
    posts = [body as unknown as RawPost];
  } else {
    return Response.json(
      { error: "Body harus berisi { posts: [...] } atau { raw_text, city_slug, ... }" },
      { status: 400 }
    );
  }

  if (posts.length > 100) {
    return Response.json(
      { error: "Maksimal 100 posts per batch." },
      { status: 400 }
    );
  }

  const supabase = createAdminClient();
  const results: IngestResult[] = [];

  for (const post of posts) {
    const result = await processPost(supabase, post);
    results.push(result);
  }

  const stats = {
    total: results.length,
    inserted: results.filter((r) => r.status === "inserted").length,
    duplicate: results.filter((r) => r.status === "duplicate").length,
    filtered: results.filter((r) => r.status === "filtered").length,
    parse_error: results.filter((r) => r.status === "parse_error").length,
  };

  return Response.json({ results, stats });
}

// ── Process single post ─────────────────────────────────────────────────────

async function processPost(
  supabase: ReturnType<typeof createAdminClient>,
  post: RawPost
): Promise<IngestResult> {
  if (!post.raw_text || !post.city_slug) {
    return {
      source_hash: "",
      status: "filtered",
      reason: "Missing raw_text or city_slug",
    };
  }

  // Pre-filter
  const filterResult = await prefilter(post.raw_text);
  if (!filterResult.passed) {
    return {
      source_hash: filterResult.source_hash ?? "",
      status: "filtered",
      reason: filterResult.reason,
    };
  }

  const sourceHash = filterResult.source_hash!;

  // Dedup
  const { data: existing } = await supabase
    .from("listings")
    .select("id")
    .eq("source_hash", sourceHash)
    .limit(1)
    .single();

  if (existing) {
    return { source_hash: sourceHash, status: "duplicate" };
  }

  // Resolve city
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

  // AI parse
  const parsed = await parseListing(filterResult.cleaned_text!);
  if (!parsed) {
    return {
      source_hash: sourceHash,
      status: "parse_error",
      reason: "AI parsing failed",
    };
  }

  // Insert
  const listing: ListingInsert = {
    city_id: city.id,
    source_hash: sourceHash,
    raw_text: filterResult.cleaned_text!,
    title: parsed.title,
    price_monthly: parsed.price_monthly,
    property_type: parsed.property_type,
    area_tag: parsed.area_tag,
    facilities: parsed.facilities,
    image_urls: post.image_urls ?? [],
    source_url: post.source_url ?? null,
    contact_wa: parsed.contact_wa,
    is_undervalued: parsed.is_undervalued,
    ai_summary: parsed.ai_summary,
  };

  const { error: insertErr } = await supabase
    .from("listings")
    .insert(listing);

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

  // Dispatch radar alerts
  await dispatchRadarAlert(listing, supabase, city.name);

  return { source_hash: sourceHash, status: "inserted" };
}
