import { type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { FREE_LISTING_LIMIT, ACCESS_TOKEN_COOKIE } from "@/lib/constants";
import { sha256 } from "@/lib/hash";
import { CITY_LISTINGS_DATA, CITY_MARKET_STATS } from "@/lib/data/listings-db";
import {
  curateDeals,
  rankDeals,
  type DealCandidate,
  type DealValuation,
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
        "id, title, price_monthly, property_type, area_tag, facilities, image_urls, ai_summary, posted_at, source_url, contact_wa, raw_text"
      )
      .eq("city_id", city.id)
      .order("posted_at", { ascending: false })
      .limit(400);

    if (error || !rawListings || rawListings.length === 0) {
      throw new Error(error?.message || "No listings in DB");
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
      listings,
      market_stats: marketStats,
      feed_mode: curated.mode,
      deals_count: dealsCount,
      total_available: selected.length,
      scoring: "kosradar-deal-engine-v1",
    });
  } catch {
    // Fallback: dataset statis multi-kota (DB belum dimigrasi / kosong).
    // Tetap dihitung dengan mesin valuasi yang sama.
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

function filterCandidates<T extends DealCandidate>(
  items: { listing: T; valuation: DealValuation }[],
  sp: URLSearchParams
): { listing: T; valuation: DealValuation }[] {
  let filtered = items;

  const propertyType = sp.get("type");
  if (propertyType) {
    filtered = filtered.filter(
      (item) => item.listing.property_type === propertyType
    );
  }

  const maxPriceRaw = sp.get("max_price");
  if (maxPriceRaw) {
    const maxPrice = parseInt(maxPriceRaw, 10);
    if (!Number.isNaN(maxPrice)) {
      filtered = filtered.filter(
        (item) =>
          item.listing.price_monthly != null &&
          item.listing.price_monthly <= maxPrice
      );
    }
  }

  const area = sp.get("area");
  if (area) {
    const query = area.toLowerCase();
    filtered = filtered.filter(
      (item) =>
        (item.listing.area_tag ?? "").toLowerCase().includes(query) ||
        (item.listing.title ?? "").toLowerCase().includes(query)
    );
  }

  const facility = sp.get("facility");
  if (facility) {
    const query = facility.toLowerCase();
    filtered = filtered.filter((item) =>
      (item.listing.facilities ?? []).some((value) =>
        value.toLowerCase().includes(query)
      )
    );
  }

  return filtered;
}

function toPublicListing(
  listing: DealCandidate,
  valuation: DealValuation,
  isPaid: boolean,
  index: number
): Record<string, unknown> {
  const publicItem: Record<string, unknown> = { ...listing };
  // Teks mentah tidak boleh keluar ke browser.
  delete publicItem.raw_text;

  Object.assign(publicItem, {
    is_undervalued: valuation.is_undervalued,
    market_value: valuation.fair_price_monthly,
    market_low: valuation.market_low,
    market_high: valuation.market_high,
    discount_pct: valuation.discount_pct,
    deal_score: valuation.deal_score,
    deal_confidence: valuation.confidence,
    deal_grade: valuation.grade,
    deal_reasons: valuation.reasons,
    risk_flags: valuation.risk_flags.slice(0, 3).map((flag) => ({
      code: flag.code,
      label: flag.label,
    })),
    sample_size: valuation.sample_size,
  });

  if (isPaid) return publicItem;

  if (index < FREE_LISTING_LIMIT) {
    return {
      ...publicItem,
      source_url: null,
      contact_wa: publicItem.contact_wa
        ? String(publicItem.contact_wa).slice(0, -4) + "****"
        : null,
    };
  }

  return {
    ...publicItem,
    source_url: null,
    contact_wa: null,
    is_locked: true,
  };
}
