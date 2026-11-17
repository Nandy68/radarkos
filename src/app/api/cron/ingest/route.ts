import { type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { ingestPosts } from "@/lib/radar/pipeline";
import type { RawPost } from "@/lib/radar/types";

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
  const { results, stats } = await ingestPosts(supabase, posts);

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

