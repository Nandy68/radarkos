import { describe, expect, it } from "vitest";
import { toPublicListing } from "@/lib/radar/public-listing";
import type { DealValuation } from "@/lib/radar/valuation";

const valuation: DealValuation = {
  fair_price_monthly: 1000000,
  market_low: 900000,
  market_high: 1100000,
  discount_pct: 20,
  price_z: -1.2,
  sample_size: 8,
  effective_sample: 8,
  confidence: 0.8,
  risk_score: 0,
  risk_flags: [],
  deal_score: 70,
  grade: "watch",
  is_undervalued: true,
  reasons: [],
  used_prior: false,
};

const listing = {
  id: 1,
  title: "Kos Putri 0812-3456-7890",
  price_monthly: 800000,
  property_type: "kos_putri",
  area_tag: "Lowokwaru",
  facilities: ["wifi"],
  image_urls: [],
  ai_summary: "Hubungi wa.me/6281234567890",
  posted_at: "2026-11-18T00:00:00Z",
  source_url: "https://t.me/kosmalang/1",
  contact_wa: "6281234567890",
  caption: "WA 081234567890",
  landlord_name: "Bu Sri 081234567890",
  address_detail: "Jl. Soekarno Hatta",
  nearby_landmarks: ["UB 081234567890"],
  rules: {},
  raw_text: "rahasia",
};

describe("toPublicListing", () => {
  it("menyensor semua teks kontak untuk user gratis", () => {
    const free = toPublicListing(listing as never, valuation, false, 0);

    expect(free.source_url).toBeNull();
    expect(free.contact_wa).toBe("628123456****");
    expect(free.caption).toBe("WA [kontak terkunci]");
    expect(free.ai_summary).toBe("Hubungi [kontak terkunci]");
    expect(free.landlord_name).toBe("Bu Sri [kontak terkunci]");
    expect(free.nearby_landmarks).toEqual(["UB [kontak terkunci]"]);
    expect(free.raw_text).toBeUndefined();
  });

  it("mengunci kontak setelah tiga listing gratis", () => {
    const locked = toPublicListing(listing as never, valuation, false, 3);

    expect(locked.contact_wa).toBeNull();
    expect(locked.is_locked).toBe(true);
    expect(locked.source_url).toBeNull();
  });

  it("membiarkan detail penuh untuk user berbayar", () => {
    const paid = toPublicListing(listing as never, valuation, true, 0);

    expect(paid.source_url).toBe("https://t.me/kosmalang/1");
    expect(paid.contact_wa).toBe("6281234567890");
    expect(paid.caption).toBe("WA 081234567890");
    expect(paid.raw_text).toBeUndefined();
  });
});
