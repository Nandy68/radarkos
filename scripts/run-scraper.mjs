/**
 * KosRadar — Multi-source Scraper Trigger
 *
 * Menjalankan collector server-side lewat /api/cron/scrape.
 * Penggunaan:
 *   node scripts/run-scraper.mjs
 *   node scripts/run-scraper.mjs --dry-run --city=malang --sources=telegram --limit=5
 */

import fs from "node:fs";
import path from "node:path";
import { resolveCronSecret } from "./lib/env.mjs";

function loadEnv() {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;

  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const [key, ...rest] = trimmed.split("=");
    const value = rest.join("=").trim().replace(/^["']|["']$/g, "");
    if (key && !process.env[key]) process.env[key] = value;
  }
}

loadEnv();

const KOSRADAR_URL =
  process.env.KOSRADAR_URL ||
  (process.env.NEXT_PUBLIC_BASE_URL &&
  !process.env.NEXT_PUBLIC_BASE_URL.includes("localhost")
    ? process.env.NEXT_PUBLIC_BASE_URL
    : "https://radarkos.web.id");

function parseArgs(argv) {
  const args = { dryRun: false };
  for (const raw of argv) {
    if (raw === "--dry-run") {
      args.dryRun = true;
      continue;
    }
    const [key, value] = raw.replace(/^--/, "").split("=");
    if (key === "city") args.city = value;
    if (key === "sources") args.sources = value;
    if (key === "limit") args.limit = value;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const city = args.city || process.env.SCRAPER_CITY || "malang";
  const sources =
    args.sources ||
    process.env.SCRAPER_SOURCES ||
    "telegram,twitter_x,facebook,instagram,web_menfess";
  const limit = args.limit || process.env.SCRAPER_LIMIT || "20";

  const params = new URLSearchParams({ city, sources, limit });
  if (args.dryRun) params.set("dry_run", "1");

  const endpoint = `${KOSRADAR_URL}/api/cron/scrape?${params.toString()}`;
  console.log(`[scraper] ${args.dryRun ? "dry-run" : "ingest"} -> ${endpoint}`);

  const response = await fetch(endpoint, {
    headers: { Authorization: `Bearer ${resolveCronSecret()}` },
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error(`[scraper] HTTP ${response.status}:`, data);
    process.exitCode = 1;
    return;
  }

  console.log(`[scraper] mode: ${data.mode} | city: ${data.city}`);
  for (const report of data.reports ?? []) {
    const status = report.ok ? "ok" : `error: ${report.error}`;
    console.log(`[scraper] ${report.key}: ${report.count} post (${status})`);
  }
  console.log(`[scraper] total collected: ${data.totals?.collected ?? 0}`);

  if (data.stats) {
    console.log("[scraper] ingest stats:", JSON.stringify(data.stats));
  }
  if (args.dryRun) {
    console.log(
      `[scraper] sample tersedia: ${data.sample?.length ?? 0} post`
    );
  }
}

main().catch((error) => {
  console.error("[scraper] fatal:", error.message);
  process.exitCode = 1;
});
