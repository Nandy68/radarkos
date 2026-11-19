/**
 * KosRadar — Google Search & Web Feeder
 *
 * Menggunakan Serper API (2.500 pencarian Google gratis) untuk mencari
 * postingan kos dan oper kontrak di Google, X/Twitter, FB, dan web publik,
 * lalu mengirimkannya langsung ke Webhook Ingestion KosRadar.
 *
 * Cara pakai:
 *   node scripts/feeder/google_search_feeder.mjs --city=malang
 *   node scripts/feeder/google_search_feeder.mjs --city=purwokerto
 */

import fs from "node:fs";
import path from "node:path";

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

const KOSRADAR_URL = process.env.NEXT_PUBLIC_BASE_URL || "https://radarkos.web.id";
const INGEST_SECRET = process.env.CRON_SECRET || process.env.INGEST_SECRET_KEY;
const SERPER_KEY = process.env.SERPER_API_KEY;

const CITIES = {
  purwokerto: { name: "Purwokerto", campuses: ["Unsoed", "UMP", "Telkom"] },
  malang: { name: "Malang", campuses: ["UB", "UM", "Polinema"] },
  yogyakarta: { name: "Yogyakarta", campuses: ["UGM", "UNY", "UPN"] },
  semarang: { name: "Semarang", campuses: ["Undip", "Unnes", "Udinus"] },
  solo: { name: "Solo", campuses: ["UNS", "UMS"] },
  bandung: { name: "Bandung", campuses: ["ITB", "Unpad", "Telkom"] },
};

async function searchGoogle(query) {
  if (!SERPER_KEY) {
    console.warn("[feeder] PERINGATAN: SERPER_API_KEY belum diisi di .env.local.");
    console.warn("[feeder] Dapatkan 2.500 pencarian Google gratis di https://serper.dev");
    return [];
  }

  try {
    const res = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "X-API-KEY": SERPER_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ q: query, gl: "id", hl: "id", num: 10 }),
    });

    if (!res.ok) {
      console.error("[feeder] Serper API error:", res.status);
      return [];
    }

    const data = await res.json();
    return data.organic || [];
  } catch (err) {
    console.error("[feeder] Gagal mencari di Google:", err.message);
    return [];
  }
}

async function sendToKosradar(posts) {
  if (!posts.length) return { inserted: 0 };

  const res = await fetch(`${KOSRADAR_URL}/api/webhook/ingest`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${INGEST_SECRET}`,
    },
    body: JSON.stringify({ posts }),
  });

  const data = await res.json().catch(() => ({}));
  return data;
}

async function main() {
  const cityArg = process.argv.find((a) => a.startsWith("--city="))?.split("=")[1] || "malang";
  const city = CITIES[cityArg] || CITIES.malang;

  console.log(`\n🔍 [Google Feeder] Mencari listing kos untuk kota: ${city.name}...`);

  const queries = [
    `site:x.com "oper kontrak" kos ${city.name}`,
    `site:facebook.com "oper kontrak" kos ${city.name}`,
    `"oper kontrak" kos ${city.campuses[0]} "08"`,
    `info kos putri ${city.name} "per bulan" "08"`,
  ];

  const allPosts = [];

  for (const q of queries) {
    console.log(`[Google] Query: ${q}`);
    const results = await searchGoogle(q);
    console.log(`  -> Ditemukan ${results.length} hasil.`);

    for (const item of results) {
      const text = `${item.title || ""}\n${item.snippet || ""}`.trim();
      if (!text) continue;

      allPosts.push({
        platform: item.link?.includes("x.com") || item.link?.includes("twitter.com")
          ? "twitter_x"
          : item.link?.includes("facebook.com")
          ? "facebook"
          : "web_public",
        city_slug: cityArg,
        raw_text: text,
        source_url: item.link || undefined,
        source_name: "Google Search Crawler",
      });
    }
  }

  console.log(`\n📦 Mengirim ${allPosts.length} kandidat ke KosRadar (${KOSRADAR_URL})...`);
  const response = await sendToKosradar(allPosts);
  console.log("✅ Respon Ingestion:", JSON.stringify(response.stats || response, null, 2));
}

main().catch(console.error);
