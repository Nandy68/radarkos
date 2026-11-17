import { describe, it, expect } from "vitest";
import {
  evaluateDeal,
  rankDeals,
  curateDeals,
  areaSimilarity,
  type DealCandidate,
} from "@/lib/radar/valuation";

const NOW = new Date("2026-11-17T12:00:00.000Z");

function listing(overrides: Partial<DealCandidate> = {}): DealCandidate {
  return {
    id: Math.random().toString(36).slice(2),
    title: "Kos Putri Pogung Kidul",
    price_monthly: 1_000_000,
    property_type: "kos_putri",
    area_tag: "Pogung Kidul (± 400m ke UGM)",
    facilities: ["KM Dalam", "WiFi", "Kasur", "Lemari"],
    posted_at: new Date(NOW.getTime() - 2 * 86_400_000).toISOString(),
    image_urls: ["https://example.com/1.jpg"],
    source_url: "https://example.com/post/1",
    contact_wa: "6281234567890",
    ...overrides,
  };
}

function marketPool(size = 10): DealCandidate[] {
  const prices = [960_000, 980_000, 1_000_000, 1_020_000, 1_040_000, 990_000, 1_060_000, 950_000, 1_010_000, 1_030_000];
  return Array.from({ length: size }, (_, index) =>
    listing({
      id: `comp-${index}`,
      price_monthly: prices[index % prices.length],
      posted_at: new Date(NOW.getTime() - index * 3 * 86_400_000).toISOString(),
    })
  );
}

describe("areaSimilarity", () => {
  it("menganggap area yang sama sangat mirip", () => {
    expect(
      areaSimilarity("Pogung Kidul, dekat UGM", "Pogung Kidul (± 400m ke UGM)")
    ).toBeGreaterThan(0.8);
  });

  it("memberi kemiripan rendah untuk area berbeda", () => {
    expect(areaSimilarity("Seturan", "Pogung Kidul")).toBeLessThan(0.3);
  });
});

describe("evaluateDeal", () => {
  it("mendeteksi listing yang jauh di bawah pasar", () => {
    const result = evaluateDeal(
      listing({ id: "target", price_monthly: 700_000 }),
      marketPool(),
      { now: NOW }
    );

    expect(result.fair_price_monthly).toBeGreaterThan(900_000);
    expect(result.fair_price_monthly).toBeLessThan(1_100_000);
    expect(result.discount_pct).toBeGreaterThan(20);
    expect(result.confidence).toBeGreaterThan(0.55);
    expect(result.is_undervalued).toBe(true);
    expect(["steal", "underpriced"]).toContain(result.grade);
    expect(result.deal_score).toBeGreaterThan(60);
  });

  it("tidak menandai listing yang harganya wajar sebagai deal", () => {
    const result = evaluateDeal(
      listing({ id: "target", price_monthly: 1_050_000 }),
      marketPool(),
      { now: NOW }
    );

    expect(Math.abs(result.discount_pct ?? 0)).toBeLessThan(10);
    expect(result.is_undervalued).toBe(false);
    expect(["fair", "watch", "overpriced"]).toContain(result.grade);
  });

  it("tahan terhadap outlier harga ekstrem", () => {
    const pool = [
      ...marketPool(),
      listing({ id: "outlier", price_monthly: 10_000_000, area_tag: "Pogung Kidul" }),
    ];
    const result = evaluateDeal(
      listing({ id: "target", price_monthly: 700_000 }),
      pool,
      { now: NOW }
    );

    expect(result.fair_price_monthly).toBeLessThan(1_100_000);
    expect(result.discount_pct).toBeGreaterThan(20);
  });

  it("mengoreksi tipe oper kontrak terhadap pasar kos normal", () => {
    const result = evaluateDeal(
      listing({
        id: "target",
        price_monthly: 600_000,
        property_type: "oper_kontrak",
      }),
      marketPool(),
      { now: NOW }
    );

    // Pasar kos putri ~1jt; setara oper kontrak berada di bawahnya.
    expect(result.fair_price_monthly).toBeGreaterThan(700_000);
    expect(result.fair_price_monthly).toBeLessThan(950_000);
    expect(result.discount_pct).toBeGreaterThan(10);
  });

  it("mengembalikan unknown bila harga tidak ada", () => {
    const result = evaluateDeal(
      listing({ id: "target", price_monthly: null }),
      marketPool(),
      { now: NOW }
    );

    expect(result.grade).toBe("unknown");
    expect(result.fair_price_monthly).toBeNull();
    expect(result.is_undervalued).toBe(false);
  });

  it("memakai prior kota saat belum ada pembanding", () => {
    const result = evaluateDeal(
      listing({ id: "target", price_monthly: 700_000 }),
      [listing({ id: "target", price_monthly: 700_000 })],
      { now: NOW, priorMonthlyPrice: 1_000_000 }
    );

    expect(result.used_prior).toBe(true);
    expect(result.fair_price_monthly).toBeCloseTo(1_000_000, -3);
    expect(result.confidence).toBeLessThan(0.45);
  });

  it("memblokir deal yang meminta transfer sebelum survey", () => {
    const target = listing({
      id: "target",
      price_monthly: 550_000,
      raw_text:
        "Kos murah 550rb, buruan transfer DP dulu sebelum survey, pemilik di luar kota. WA 081234567890",
    });
    const result = evaluateDeal(target, marketPool(), { now: NOW });

    expect(result.risk_score).toBeGreaterThanOrEqual(30);
    expect(result.risk_flags.some((flag) => flag.code === "payment_before_viewing")).toBe(true);
    expect(result.is_undervalued).toBe(false);
    expect(["watch", "fair"]).toContain(result.grade);
  });

  it("menaikkan keyakinan saat pembanding makin banyak", () => {
    const few = evaluateDeal(
      listing({ id: "target", price_monthly: 700_000 }),
      marketPool(3),
      { now: NOW }
    );
    const many = evaluateDeal(
      listing({ id: "target", price_monthly: 700_000 }),
      marketPool(10),
      { now: NOW }
    );

    expect(many.confidence).toBeGreaterThan(few.confidence);
    expect(many.sample_size).toBeGreaterThan(few.sample_size);
  });

  it("menandai listing basi", () => {
    const result = evaluateDeal(
      listing({
        id: "target",
        price_monthly: 700_000,
        posted_at: new Date(NOW.getTime() - 150 * 86_400_000).toISOString(),
      }),
      marketPool(),
      { now: NOW }
    );

    expect(result.risk_flags.some((flag) => flag.code === "very_stale")).toBe(true);
    expect(result.deal_score).toBeLessThan(75);
  });
});

describe("rankDeals & curateDeals", () => {
  it("menempatkan deal di atas listing biasa", () => {
    const ranked = rankDeals(
      [
        ...marketPool(),
        listing({ id: "normal", price_monthly: 1_050_000 }),
        listing({ id: "cheap", price_monthly: 650_000 }),
      ],
      { now: NOW }
    );

    expect(ranked[0].valuation.is_undervalued).toBe(true);
    expect(ranked[0].valuation.discount_pct).toBeGreaterThan(25);
    expect(ranked[ranked.length - 1].valuation.is_undervalued).toBe(false);
  });

  it("mode deals hanya berisi listing below-market", () => {
    const ranked = rankDeals(
      [
        ...marketPool(),
        listing({ id: "normal", price_monthly: 1_050_000 }),
        listing({ id: "cheap", price_monthly: 650_000 }),
      ],
      { now: NOW }
    );
    const curated = curateDeals(ranked);

    expect(curated.mode).toBe("deals");
    expect(curated.items.every((item) => item.valuation.is_undervalued)).toBe(true);
    expect(curated.items[0].listing.id).toBe("cheap");
  });

  it("fallback saat tidak ada deal agar feed tidak kosong", () => {
    const ranked = rankDeals(
      [
        listing({ id: "normal-1", price_monthly: 1_000_000 }),
        listing({ id: "normal-2", price_monthly: 1_050_000 }),
      ],
      { now: NOW }
    );
    const curated = curateDeals(ranked);

    expect(curated.mode).toBe("fallback");
    expect(curated.items.length).toBeGreaterThan(0);
  });
});
