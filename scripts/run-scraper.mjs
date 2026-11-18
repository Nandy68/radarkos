/**
 * KosRadar — Autonomous 24/7 Scraper Engine
 *
 * Mengambil listing kos baru dari sumber publik (Telegram channels, Open Web,
 * dan Community Feeds), menormalisasi, dan mengirim batch posts ke endpoint
 * `/api/cron/ingest` KosRadar.
 *
 * Penggunaan:
 *   node scripts/run-scraper.mjs
 * atau via GitHub Actions cron setiap 30 menit.
 */

import fs from "node:fs";
import path from "node:path";

// ── 1. Baca Konfigurasi Lingkungan ──────────────────────────────────────────
function loadEnv() {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, "utf-8").split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith("#") && trimmed.includes("=")) {
        const [key, ...rest] = trimmed.split("=");
        const val = rest.join("=").trim().replace(/^["']|["']$/g, "");
        if (key && !process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
}

loadEnv();

const KOSRADAR_URL =
  process.env.KOSRADAR_URL ||
  (process.env.NEXT_PUBLIC_BASE_URL && !process.env.NEXT_PUBLIC_BASE_URL.includes("localhost")
    ? process.env.NEXT_PUBLIC_BASE_URL
    : "https://radarkos.web.id");

const CRON_SECRET =
  process.env.CRON_SECRET ||
  process.env.INGEST_SECRET_KEY ||
  "283c09b27f592ff5cab3b092c9cbd536fb7778d2bcfaecc7afe5b912310681fe";

console.log(`[scraper] KosRadar Target URL: ${KOSRADAR_URL}`);

// ── 2. Daftar Sumber Scraping Per Kota ───────────────────────────────────────
const SCRAPE_TARGETS = [
  // Purwokerto (Unsoed, UMP, Telkom)
  {
    city_slug: "purwokerto",
    type: "telegram",
    channel: "infokospurwokerto",
  },

  // Yogyakarta (UGM, UNY, UPN, UII)
  {
    city_slug: "yogyakarta",
    type: "telegram",
    channel: "kosjogjaupdate",
  },
  {
    city_slug: "yogyakarta",
    type: "telegram",
    channel: "infokosjogja",
  },
  {
    city_slug: "yogyakarta",
    type: "telegram",
    channel: "carikosjogja",
  },

  // Malang (UB, UM, UIN, Polinema)
  {
    city_slug: "malang",
    type: "telegram",
    channel: "infokosmalang",
  },
  {
    city_slug: "malang",
    type: "telegram",
    channel: "kosmalang",
  },

  // Semarang (Undip, Unnes, Udinus)
  {
    city_slug: "semarang",
    type: "telegram",
    channel: "kossemarang",
  },
  {
    city_slug: "semarang",
    type: "telegram",
    channel: "infokossemarang",
  },

  // Solo (UNS, UMS)
  {
    city_slug: "solo",
    type: "telegram",
    channel: "kostsolo",
  },
  {
    city_slug: "solo",
    type: "telegram",
    channel: "infokostsolo",
  },
];

// ── 3. Parser HTML Telegram Publik ──────────────────────────────────────────
async function scrapeTelegramChannel(channel, citySlug) {
  const url = `https://t.me/s/${channel}`;
  const posts = [];

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });

    if (!res.ok) {
      console.warn(`[scraper] Telegram channel @${channel} returned HTTP ${res.status}`);
      return posts;
    }

    const html = await res.text();

    // Ekstrak pesan menggunakan regex blok widget Telegram
    const messageBlocks = [
      ...html.matchAll(
        /<div class="tgme_widget_message_wrap[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/g
      ),
    ];

    for (const block of messageBlocks) {
      const blockHtml = block[1];

      // Ambil teks pesan
      const textMatch = blockHtml.match(
        /<div class="tgme_widget_message_text[^>]*>([\s\S]*?)<\/div>/
      );
      if (!textMatch) continue;

      const rawText = textMatch[1]
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, "$2 ($1)")
        .replace(/<[^>]+>/g, "")
        .trim();

      // Filter: Hanya ambil jika mengandung kata kunci kos/kontrakan
      const lower = rawText.toLowerCase();
      const isKosRelated =
        lower.includes("kos") ||
        lower.includes("kost") ||
        lower.includes("kamar") ||
        lower.includes("oper") ||
        lower.includes("kontrak") ||
        lower.includes("sewa");

      if (!isKosRelated || rawText.length < 30) continue;

      // Ambil tautan pesan asli
      const linkMatch = blockHtml.match(
        /<a class="tgme_widget_message_date" href="([^"]+)"/
      );
      const sourceUrl = linkMatch ? linkMatch[1] : `https://t.me/${channel}`;

      // Ambil foto jika ada
      const imageUrls = [];
      const photoMatches = [
        ...blockHtml.matchAll(/background-image:url\('([^']+)'\)/g),
      ];
      for (const p of photoMatches) {
        const imgUrl = p[1];
        if (
          imgUrl &&
          !imageUrls.includes(imgUrl) &&
          !imgUrl.includes("/emoji/") &&
          !imgUrl.includes("emoji.php") &&
          !imgUrl.includes("unsplash.com") &&
          !imgUrl.endsWith(".svg")
        ) {
          imageUrls.push(imgUrl);
        }
      }

      posts.push({
        raw_text: rawText,
        source_url: sourceUrl,
        image_urls: imageUrls.slice(0, 4),
        city_slug: citySlug,
        platform: "telegram",
      });
    }

    console.log(
      `[scraper] Telegram @${channel} (${citySlug}): berhasil ambil ${posts.length} listing valid.`
    );
  } catch (err) {
    console.warn(`[scraper] Gagal scrape Telegram @${channel}:`, err.message);
  }

  return posts;
}

// ── 4. Pengirim Batch Ingestion ke API KosRadar ──────────────────────────────
async function pushBatchToApi(posts) {
  if (!posts || posts.length === 0) {
    console.log("[scraper] Tidak ada postingan baru untuk dikirim.");
    return;
  }

  const endpoint = `${KOSRADAR_URL}/api/cron/ingest`;
  console.log(`[scraper] Mengirim batch ${posts.length} postingan ke ${endpoint}...`);

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${CRON_SECRET}`,
      },
      body: JSON.stringify({ posts }),
    });

    const data = await res.json();

    if (!res.ok) {
      console.error(`[scraper] Endpoint returned HTTP ${res.status}:`, data);
      return;
    }

    console.log("[scraper] Batch Ingestion Sukses!");
    console.log("[scraper] Statistik Ingestion:", JSON.stringify(data.stats, null, 2));
    if (data.results) {
      const deals = data.results.filter((r) => r.is_undervalued);
      console.log(`[scraper] Terdeteksi ${deals.length} kamar kos DI BAWAH PASAR (undervalued)!`);
    }
  } catch (err) {
    console.error("[scraper] Gagal mengirim batch ke API:", err.message);
  }
}

// ── 6. Runner Utama ─────────────────────────────────────────────────────────
async function run() {
  console.log("==================================================");
  console.log("⚡ KosRadar Scraper Engine — Memulai Pemindaian...");
  console.log("==================================================");

  const allScrapedPosts = [];

  // Scrape dari target telegram
  for (const target of SCRAPE_TARGETS) {
    if (target.type === "telegram" && target.channel) {
      const posts = await scrapeTelegramChannel(target.channel, target.city_slug);
      allScrapedPosts.push(...posts);
    }
  }

  console.log(`[scraper] Total postingan terkumpul: ${allScrapedPosts.length}`);

  // Kirim dalam chunk maksimal 40 per batch
  const chunkSize = 40;
  for (let i = 0; i < allScrapedPosts.length; i += chunkSize) {
    const chunk = allScrapedPosts.slice(i, i + chunkSize);
    await pushBatchToApi(chunk);
  }

  console.log("==================================================");
  console.log("✅ Pemindaian & Ingestion Selesai!");
  console.log("==================================================");
}

run().catch((err) => {
  console.error("[scraper] Fatal error:", err);
  process.exit(1);
});
