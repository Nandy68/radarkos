import { describe, it, expect } from "vitest";
import { generateWAMessage, generateWALink } from "@/lib/radar/negotiator";
import type { ParsedListing } from "@/lib/radar/types";

describe("generateWAMessage", () => {
  const sampleListing: ParsedListing = {
    title: "Kos Eksklusif AC WiFi Kamar Mandi Dalam",
    price_monthly: 1200000,
    property_type: "kos_putra",
    area_tag: "Pogung Dalangan",
    facilities: ["ac", "wifi", "kamar mandi dalam", "kasur"],
    contact_wa: "6281234567890",
    is_undervalued: false,
    ai_summary: "Kos putra eksklusif dekat UGM dengan fasilitas lengkap.",
  };

  it("should generate inquiry message by default", () => {
    const msg = generateWAMessage({ listing: sampleListing });
    expect(msg).toContain("kos putra");
    expect(msg).toContain(sampleListing.title);
    expect(msg).toContain("Pogung Dalangan");
    expect(msg).toContain("Rp1.200.000/bulan");
    expect(msg).toContain("Apakah kamar masih tersedia?");
  });

  it("should personalize with user name when provided", () => {
    const msg = generateWAMessage({
      listing: sampleListing,
      userName: "Budi",
      mode: "inquiry",
    });
    expect(msg).toContain("Perkenalkan, saya Budi.");
  });

  it("should generate negotiate message", () => {
    const msg = generateWAMessage({
      listing: sampleListing,
      mode: "negotiate",
    });
    expect(msg).toContain("Apakah bisa dapat harga spesial");
    expect(msg).toContain("Rp1.200.000/bulan");
  });

  it("should generate booking message", () => {
    const msg = generateWAMessage({
      listing: sampleListing,
      mode: "booking",
    });
    expect(msg).toContain("Bagaimana prosedur pembayaran DP/uang muka?");
    expect(msg).toContain("Kapan bisa mulai masuk?");
  });

  it("should handle null price and property_type gracefully", () => {
    const incompleteListing: ParsedListing = {
      title: "Kos Murah Tanpa Harga",
      price_monthly: null,
      property_type: null,
      area_tag: null,
      facilities: [],
      contact_wa: null,
      is_undervalued: false,
      ai_summary: "Kos murah.",
    };
    const msg = generateWAMessage({ listing: incompleteListing });
    expect(msg).toContain("belum tercantum/bulan");
    expect(msg).toContain("kamar kos");
  });
});

describe("generateWALink", () => {
  it("should generate a valid wa.me URL with encoded message", () => {
    const link = generateWALink("6281234567890", "Halo test");
    expect(link).toBe("https://wa.me/6281234567890?text=Halo%20test");
  });
});
