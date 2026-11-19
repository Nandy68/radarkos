import { type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { ingestPosts } from "@/lib/radar/pipeline";
import { collectAllSources } from "@/lib/scraper/collect";
import { createCollectors } from "@/lib/scraper/collectors";
import { CITIES } from "@/lib/scraper/config";
import { fetchText } from "@/lib/scraper/http";
import type { CollectorKey } from "@/lib/scraper/types";

export const maxDuration = 60;

const INGEST_SECRET = process.env.CRON_SECRET || process.env.INGEST_SECRET_KEY;

const ALLOWED_SOURCES: CollectorKey[] = [
  "telegram",
  "twitter_x",
  "facebook",
  "instagram",
  "web_menfess",
];

function isAuthorized(request: NextRequest): boolean {
  if (!INGEST_SECRET) return false;
  const headerKey = request.headers.get("x-ingest-key");
  const authHeader = request.headers.get("authorization");
  const bearerKey = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7)
    : null;
  return headerKey === INGEST_SECRET || bearerKey === INGEST_SECRET;
}

function parseSources(raw: string | null): CollectorKey[] {
  const requested = (raw || process.env.SCRAPER_SOURCES || ALLOWED_SOURCES.join(","))
    .split(",")
    .map((value) => value.trim())
    .filter((value): value is CollectorKey =>
      ALLOWED_SOURCES.includes(value as CollectorKey)
    );

  return requested.length > 0 ? requested : [...ALLOWED_SOURCES];
}

function parseLimit(raw: string | null): number {
  const parsed = Number.parseInt(raw || process.env.SCRAPER_LIMIT || "20", 10);
  if (!Number.isFinite(parsed)) return 20;
  return Math.min(30, Math.max(5, parsed));
}

async function handle(request: NextRequest) {
  if (!isAuthorized(request)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sp = request.nextUrl.searchParams;
  const citySlug = (sp.get("city") || process.env.SCRAPER_CITY || "malang").toLowerCase();

  if (!CITIES[citySlug]) {
    return Response.json(
      { error: `Kota '${citySlug}' tidak didukung.` },
      { status: 400 }
    );
  }

  const sourceKeys = parseSources(sp.get("sources"));
  const limit = parseLimit(sp.get("limit"));
  const dryRun = sp.get("dry_run") === "1" || sp.get("dry-run") === "1";

  const collectors = createCollectors(sourceKeys);
  const { posts, reports } = await collectAllSources(collectors, {
    citySlug,
    limit,
    env: process.env,
    fetchText,
  });

  if (dryRun) {
    return Response.json({
      mode: "dry_run",
      city: citySlug,
      reports,
      totals: { collected: posts.length, collectors: collectors.length },
      sample: posts.slice(0, 10),
    });
  }

  const supabase = createAdminClient();
  const { results, stats } = await ingestPosts(supabase, posts);

  return Response.json({
    mode: "ingest",
    city: citySlug,
    reports,
    totals: { collected: posts.length, collectors: collectors.length },
    stats,
    results,
  });
}

/**
 * GET/POST /api/cron/scrape?city=malang&sources=telegram,twitter_x&limit=20&dry_run=1
 * Auth: Bearer CRON_SECRET atau x-ingest-key.
 */
export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
