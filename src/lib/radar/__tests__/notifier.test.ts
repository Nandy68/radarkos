import { describe, it, expect, vi } from "vitest";
import {
  isMatchingCriteria,
  formatAlertMessage,
  sendWhatsAppMessage,
} from "@/lib/radar/notifier";
import type { ListingInsert } from "@/lib/radar/types";

describe("isMatchingCriteria", () => {
  const sampleListing: ListingInsert = {
    city_id: 1,
    source_hash: "hash123",
    raw_text: "Kos murah",
    title: "Kos Putri AC Dekat Kampus UGM",
    price_monthly: 800000,
    property_type: "kos_putri",
    area_tag: "Pogung Dalangan",
    facilities: ["ac", "wifi"],
    image_urls: [],
    source_url: "https://facebook.com/groups/123",
    contact_wa: "6281234567890",
    is_undervalued: false,
    ai_summary: "Kos putri dekat UGM.",
  };

  it("should match when criteria is null or empty", () => {
    expect(isMatchingCriteria(null, sampleListing)).toBe(true);
    expect(isMatchingCriteria({}, sampleListing)).toBe(true);
  });

  it("should match within price limit", () => {
    expect(isMatchingCriteria({ max_price: 1000000 }, sampleListing)).toBe(true);
    expect(isMatchingCriteria({ max_price: 800000 }, sampleListing)).toBe(true);
  });

  it("should reject when price exceeds max_price", () => {
    expect(isMatchingCriteria({ max_price: 750000 }, sampleListing)).toBe(false);
  });

  it("should match property_type", () => {
    expect(isMatchingCriteria({ property_type: "kos_putri" }, sampleListing)).toBe(true);
    expect(isMatchingCriteria({ property_type: "kos_putra" }, sampleListing)).toBe(false);
  });

  it("should match area by partial match in area_tag or title", () => {
    expect(isMatchingCriteria({ area: "pogung" }, sampleListing)).toBe(true);
    expect(isMatchingCriteria({ area: "ugm" }, sampleListing)).toBe(true);
    expect(isMatchingCriteria({ area: "seturan" }, sampleListing)).toBe(false);
  });
});

describe("formatAlertMessage", () => {
  const sampleListing: ListingInsert = {
    city_id: 1,
    source_hash: "hash123",
    raw_text: "Kos murah",
    title: "Kos Putra AC Murah",
    price_monthly: 650000,
    property_type: "kos_putra",
    area_tag: "Grendeng Unsoed",
    facilities: ["ac", "wifi", "kamar mandi dalam"],
    image_urls: [],
    source_url: "https://x.com/post/123",
    contact_wa: "6281234567890",
    is_undervalued: true,
    ai_summary: "Kos murah bawah pasar.",
  };

  it("should format alert message with all key information", () => {
    const msg = formatAlertMessage(sampleListing, "Purwokerto");
    expect(msg).toContain("RADAR ALERT KOSBARU");
    expect(msg).toContain("Kos Putra AC Murah");
    expect(msg).toContain("Rp650.000 / bulan");
    expect(msg).toContain("DI BAWAH PASAR");
    expect(msg).toContain("Grendeng Unsoed");
    expect(msg).toContain("https://wa.me/6281234567890");
    expect(msg).toContain("https://x.com/post/123");
  });
});

describe("sendWhatsAppMessage", () => {
  it("should succeed in mock mode when WA_GATEWAY_URL is not set", async () => {
    delete process.env.WA_GATEWAY_URL;
    const res = await sendWhatsAppMessage("628123456789", "Halo");
    expect(res.success).toBe(true);
  });

  it("should dispatch POST to gateway URL when configured", async () => {
    process.env.WA_GATEWAY_URL = "https://mock-gateway.local/send";
    process.env.WA_GATEWAY_TOKEN = "test-token";

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: true }),
    });

    const res = await sendWhatsAppMessage("6281234567890", "Halo test", mockFetch as unknown as typeof fetch);
    expect(res.success).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(
      "https://mock-gateway.local/send",
      expect.objectContaining({
        method: "POST",
      })
    );

    delete process.env.WA_GATEWAY_URL;
    delete process.env.WA_GATEWAY_TOKEN;
  });
});
