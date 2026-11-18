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
 * - Mode 1 (Batch Ingestion): Mengirim { posts: RawPost[] } untuk diproses pipeline.
 * - Mode 2 (Cron Heartbeat/Trigger): Dipanggil tanpa posts (dari GitHub Actions / Vercel Cron)
 *   untuk memicu pengecekan sumber atau mengembalikan target scraping yang perlu diambil.
 *
 * Auth: Header `Authorization: Bearer <CRON_SECRET>` atau `x-ingest-key`.
 */
export async function POST(request: NextRequest) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  if (!isAuthorized(request)) {
    return Response.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  // ── Parse body secara aman ────────────────────────────────────────────────
  let posts: RawPost[] = [];
  let isWipeAction = false;
  let isCleanGarbage = false;
  try {
    const text = await request.text();
    if (text && text.trim()) {
      const body = JSON.parse(text);
      if (body?.action === "wipe_all_listings") {
        isWipeAction = true;
      }
      if (body?.action === "clean_garbage_listings") {
        isCleanGarbage = true;
      }
      if (Array.isArray(body?.posts)) {
        posts = body.posts;
      }
    }
  } catch {
    // Body bukan JSON atau kosong, diproses sebagai cron heartbeat
  }

  const supabase = createAdminClient();

  if (isCleanGarbage) {
    const { error, count } = await supabase
      .from("listings")
      .delete()
      .is("price_monthly", null);

    if (error) {
      return Response.json({ success: false, error: error.message }, { status: 500 });
    }

    return Response.json({
      success: true,
      message: "Listing tanpa harga / pesan non-kamar berhasil dibersihkan.",
      deleted_count: count,
    });
  }

  if (isWipeAction) {
    const { error, count } = await supabase
      .from("listings")
      .delete()
      .gte("id", 0);

    if (error) {
      return Response.json(
        { success: false, error: error.message },
        { status: 500 }
      );
    }

    return Response.json({
      success: true,
      message: "Semua data listing lama/mock berhasil dihapus dari database.",
      deleted_count: count,
    });
  }

  // Jika payload berisi posts, proses melalui pipeline ingestion
  if (posts.length > 0) {
    if (posts.length > 50) {
      return Response.json(
        { error: "Maksimal 50 posts per batch." },
        { status: 400 }
      );
    }

    const { results, stats } = await ingestPosts(supabase, posts);
    return Response.json({ mode: "batch_ingest", results, stats });
  }

  // Jika dipanggil tanpa posts (misal oleh GitHub Actions / trigger cron)
  const { data: sources, error } = await supabase
    .from("sources")
    .select("id, city_id, platform, url, last_scraped_at")
    .order("last_scraped_at", { ascending: true, nullsFirst: true })
    .limit(20);

  if (error) {
    return Response.json({
      success: true,
      mode: "cron_trigger",
      warning: "Database query error: " + error.message,
      sources: [],
    });
  }

  return Response.json({
    success: true,
    mode: "cron_trigger",
    message: "Cron ingestion heartbeat sukses. Menunggu scraping batch dari agen.",
    sources_due: sources ?? [],
    total_sources: sources?.length ?? 0,
  });
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

/**
 * DELETE /api/cron/ingest
 *
 * Wipe all listings or mock seed listings from database.
 * Auth: Header `Authorization: Bearer <CRON_SECRET>` atau `x-ingest-key`.
 */
export async function DELETE(request: NextRequest) {
  if (!isAuthorized(request)) {
    return Response.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  const supabase = createAdminClient();

  // Hapus semua listing di tabel listings
  const { error, count } = await supabase
    .from("listings")
    .delete()
    .gte("id", 0);

  if (error) {
    return Response.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }

  return Response.json({
    success: true,
    message: "Semua data listing lama/mock berhasil dihapus dari database.",
    deleted_count: count,
  });
}


