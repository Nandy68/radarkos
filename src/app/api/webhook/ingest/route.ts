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
  const { results, stats } = await ingestPosts(supabase, posts);

  return Response.json({ results, stats });
}

