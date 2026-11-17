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
 * POST /api/cron/ingest
 *
 * Dual-mode ingestion endpoint:
 * - Vercel Cron / GitHub Actions → bisa panggil secara periodik.
 * - Mengirim batch posts untuk diproses.
 *
 * Auth: Header `Authorization: Bearer <CRON_SECRET>` atau `x-ingest-key`.
 *
 * Body: { posts: RawPost[] }
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
  let body: { posts?: RawPost[] };
  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  const posts = body.posts;
  if (!Array.isArray(posts) || posts.length === 0) {
    return Response.json(
      { error: "Field 'posts' harus berupa array non-kosong." },
      { status: 400 }
    );
  }

  // Cap batch size
  if (posts.length > 50) {
    return Response.json(
      { error: "Maksimal 50 posts per batch." },
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

/**
 * GET /api/cron/ingest
 *
 * Vercel Cron trigger: ambil sources yang perlu di-scrape.
 * Untuk sekarang, return daftar sources yang sudah lama tidak di-scrape.
 * Scraping sebenarnya dilakukan oleh Hermes Agent yang akan POST kembali.
 */
export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return Response.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  const supabase = createAdminClient();

  const { data: sources, error } = await supabase
    .from("sources")
    .select("id, city_id, platform, url, last_scraped_at")
    .order("last_scraped_at", { ascending: true, nullsFirst: true })
    .limit(10);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({
    sources: sources ?? [],
    message: "Hermes Agent harus scrape sumber-sumber ini dan POST hasilnya ke /api/webhook/ingest.",
  });
}

// ── Process single post ─────────────────────────────────────────────────────

async function processPost(
  supabase: ReturnType<typeof createAdminClient>,
  post: RawPost
): Promise<IngestResult> {
  // 1. Validate required fields
  if (!post.raw_text || !post.city_slug) {
    return {
      source_hash: "",
      status: "filtered",
      reason: "Missing raw_text or city_slug",
    };
  }

  // 2. Pre-filter
  const filterResult = await prefilter(post.raw_text);
  if (!filterResult.passed) {
    return {
      source_hash: filterResult.source_hash ?? "",
      status: "filtered",
      reason: filterResult.reason,
    };
  }

  const sourceHash = filterResult.source_hash!;

  // 3. Dedup check against DB
  const { data: existing } = await supabase
    .from("listings")
    .select("id")
    .eq("source_hash", sourceHash)
    .limit(1)
    .single();

  if (existing) {
    return {
      source_hash: sourceHash,
      status: "duplicate",
    };
  }

  // 4. Resolve city
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

  // 5. AI parse
  const parsed = await parseListing(filterResult.cleaned_text!);
  if (!parsed) {
    return {
      source_hash: sourceHash,
      status: "parse_error",
      reason: "AI parsing failed",
    };
  }

  // 6. Insert listing
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
    // Duplicate source_hash constraint violation — treat as dedup
    if (insertErr.code === "23505") {
      return { source_hash: sourceHash, status: "duplicate" };
    }
    return {
      source_hash: sourceHash,
      status: "parse_error",
      reason: `DB insert error: ${insertErr.message}`,
    };
  }

  // 7. Dispatch radar alerts to matching active subscribers
  await dispatchRadarAlert(listing, supabase, city.name);

  return { source_hash: sourceHash, status: "inserted" };
}
