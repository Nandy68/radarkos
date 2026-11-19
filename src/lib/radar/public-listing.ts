/**
 * Mapper listing DB → payload publik.
 * Satu tempat untuk semua masking user gratis (kontak & link sumber).
 */

import { FREE_LISTING_LIMIT } from "@/lib/constants";
import { sanitizeFreeText } from "./sanitize";
import type { DealCandidate, DealValuation } from "./valuation";

export function filterCandidates<T extends DealCandidate>(
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

const VISIBLE_TEXT_FIELDS = [
  "title",
  "ai_summary",
  "clean_summary",
  "caption",
  "address_detail",
  "landlord_name",
  "campus_proximity",
  "area_tag",
  "source_name",
  "price_raw",
] as const;

const MAPS_URL =
  /^https?:\/\/(?:www\.)?(?:google\.[a-z.]+\/maps|maps\.google\.[a-z.]+|maps\.app\.goo\.gl)(?:[/?#]|$)/i;

function sanitizeListingText(
  value: Record<string, unknown>
): Record<string, unknown> {
  const sanitized = { ...value };

  for (const field of VISIBLE_TEXT_FIELDS) {
    sanitized[field] = sanitizeFreeText(sanitized[field] as string | null);
  }

  if (Array.isArray(sanitized.nearby_landmarks)) {
    sanitized.nearby_landmarks = sanitized.nearby_landmarks
      .map((item) => (typeof item === "string" ? sanitizeFreeText(item) : item))
      .filter((item): item is string => typeof item === "string");
  }

  if (Array.isArray(sanitized.facilities)) {
    sanitized.facilities = sanitized.facilities
      .map((item) => (typeof item === "string" ? sanitizeFreeText(item) : item))
      .filter((item): item is string => typeof item === "string");
  }

  return sanitized;
}

export function toPublicListing(
  listing: DealCandidate,
  valuation: DealValuation,
  isPaid: boolean,
  index: number
): Record<string, unknown> {
  const publicItem: Record<string, unknown> = {
    ...(listing as unknown as Record<string, unknown>),
  };
  // Teks mentah tidak boleh keluar ke browser.
  delete publicItem.raw_text;

  // Filter gambar: buang foto stock palsu dan icon emoji telegram
  const rawImages = Array.isArray(listing.image_urls) ? listing.image_urls : [];
  publicItem.image_urls = rawImages.filter(
    (url) =>
      typeof url === "string" &&
      !url.includes("/emoji/") &&
      !url.includes("emoji.php") &&
      !url.includes("unsplash.com") &&
      !url.endsWith(".svg")
  );

  if (
    typeof publicItem.maps_url === "string" &&
    !MAPS_URL.test(publicItem.maps_url)
  ) {
    publicItem.maps_url = null;
  }

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

  const sanitized = sanitizeListingText(publicItem);
  sanitized.source_url = null;

  if (index < FREE_LISTING_LIMIT) {
    return {
      ...sanitized,
      contact_wa: sanitized.contact_wa
        ? String(sanitized.contact_wa).slice(0, -4) + "****"
        : null,
    };
  }

  return {
    ...sanitized,
    contact_wa: null,
    is_locked: true,
  };
}
