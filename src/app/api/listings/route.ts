import { type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { ACCESS_TOKEN_COOKIE } from "@/lib/constants";
import { sha256 } from "@/lib/hash";
import { CITY_LISTINGS_DATA, CITY_MARKET_STATS } from "@/lib/data/listings-db";
import { filterCandidates, toPublicListing } from "@/lib/radar/public-listing";
import {
  curateDeals,
  rankDeals,
  type DealCandidate,
} from "@/lib/radar/valuation";

/**
 * GET /api/listings?city=<slug>&page=1&type=&max_price=&area=&facility=
 *
 * Feed ini BUKAN katalog mentah. Setiap listing dinilai dulu oleh
 * Deal Valuation Engine:
 *   - harga pasar area/tipe dihitung dari pembanding (robust median + hedonic)
 *   - diskon, keyakinan model, dan red flag dihitung
 *   - hanya listing below-market yang lolos kurasi yang ditampilkan sebagai deal
 *
 * Gratis: 3 listing teratas dengan WA disensor.
 * Berbayar (cookie kosradar_session valid): semua listing terbuka penuh.
 */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const citySlug = (sp.get("city") || "purwokerto").toLowerCase();
  const marketStats =
    CITY_MARKET_STATS[citySlug] || CITY_MARKET_STATS.purwokerto;
  const priorMonthlyPrice = parsePriorPrice(marketStats.avgPrice);

  // --- Check subscription cookie ---
  let isPaid = false;
  const token = request.cookies.get(ACCESS_TOKEN_COOKIE)?.value;

  try {
    const supabase = createAdminClient();

    // --- Resolve city from Supabase ---
    const { data: city, error: cityErr } = await supabase
      .from("cities")
      .select("id")
      .eq("slug", citySlug)
      .eq("is_active", true)
      .single();

    if (cityErr || !city) {
      throw new Error(cityErr?.message || "City not found in DB");
    }

    if (token) {
      const tokenHash = await sha256(token);
      const { data: sub } = await supabase
        .from("subscriptions")
        .select("id, expires_at")
        .eq("access_token_hash", tokenHash)
        .eq("city_id", city.id)
        .eq("status", "active")
        .gt("expires_at", new Date().toISOString())
        .limit(1)
        .single();

      isPaid = !!sub;
    }

    // Ambil kandidat kota secukupnya. Filter tipe/harga/area dilakukan
    // SETELAH valuasi agar baseline pasar tidak berubah karena filter user.
    const { data: rawListings, error } = await supabase
      .from("listings")
      .select(
        "id, title, price_monthly, price_raw, price_period, price_total, deposit_idr, room_size_m2, is_negotiable, property_type, area_tag, facilities, image_urls, ai_summary, posted_at, posted_at_source, source_url, contact_wa, source_platform, source_name, caption, address_detail, maps_url, landlord_name, landlord_type, bathroom_type, electricity, water, min_stay_months, available_from, rules, nearby_landmarks, raw_text"
      )
      .eq("city_id", city.id)
      .order("posted_at", { ascending: false })
      .limit(400);

    if (error) {
      throw new Error(error.message);
    }

    // Jika DB terhubung tetapi belum ada listing nyata untuk kota ini,
    // kembalikan array kosong agar feed jujur dan tidak menampilkan data mock tiruan.
    if (!rawListings || rawListings.length === 0) {
      return Response.json({
        city: citySlug,
        is_paid: isPaid,
        source: "database",
        db_connected: true,
        listings: [],
        market_stats: marketStats,
        feed_mode: "deals",
        deals_count: 0,
        total_available: 0,
        scoring: "kosradar-deal-engine-v1",
      });
    }

    const pool = rawListings as DealCandidate[];
    const ranked = rankDeals(pool, { priorMonthlyPrice });
    const curated = curateDeals(ranked);
    const dealsCount = ranked.filter((item) => item.valuation.is_undervalued).length;

    // Kurasi below-market dulu; kalau filter user tidak menemukan deal,
    // tampilkan hasil peringkat penuh agar feed tidak kosong.
    let selected = filterCandidates(curated.items, sp);
    if (selected.length === 0 && curated.mode === "deals") {
      selected = filterCandidates(ranked, sp);
    }

    const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10));
    const perPage = 20;
    const from = (page - 1) * perPage;
    const paged = selected.slice(from, from + perPage);

    const listings = paged.map(({ listing, valuation }, index) =>
      toPublicListing(listing, valuation, isPaid, index + from)
    );

    return Response.json({
      city: citySlug,
      is_paid: isPaid,
      source: "database",
      db_connected: true,
      listings,
      market_stats: marketStats,
      feed_mode: curated.mode,
      deals_count: dealsCount,
      total_available: selected.length,
      scoring: "kosradar-deal-engine-v1",
    });
  } catch (err) {
    // Fallback: dataset statis multi-kota (DB belum dimigrasi / kosong / credentials belum diatur).
    // Tetap dihitung dengan mesin valuasi yang sama.
    console.warn("[api/listings] Database query gagal atau belum terkonfigurasi, fallback ke static dataset:", err instanceof Error ? err.message : err);

    const baseDataset =
      CITY_LISTINGS_DATA[citySlug] || CITY_LISTINGS_DATA.purwokerto;
    const ranked = rankDeals(baseDataset as DealCandidate[], { priorMonthlyPrice });
    const curated = curateDeals(ranked);
    const dealsCount = ranked.filter((item) => item.valuation.is_undervalued).length;

    let selected = filterCandidates(curated.items, sp);
    if (selected.length === 0 && curated.mode === "deals") {
      selected = filterCandidates(ranked, sp);
    }

    const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10));
    const perPage = 20;
    const from = (page - 1) * perPage;
    const paged = selected.slice(from, from + perPage);
    const demoUnlocked = token === "demo_unlocked";

    const listings = paged.map(({ listing, valuation }, index) =>
      toPublicListing(listing, valuation, isPaid || demoUnlocked, index + from)
    );

    return Response.json({
      city: citySlug,
      is_paid: isPaid || demoUnlocked,
      source: "static_fallback",
      db_connected: false,
      listings,
      market_stats: marketStats,
      feed_mode: curated.mode,
      deals_count: dealsCount,
      total_available: selected.length,
      scoring: "kosradar-deal-engine-v1",
    });
  }
}

function parsePriorPrice(avgPrice: string): number | null {
  const numeric = Number(avgPrice.replace(/[^\d]/g, ""));
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

