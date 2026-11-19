import { describe, it, expect } from "vitest";
import { parseAndValidate, parseHeuristic } from "@/lib/radar/parser";

// ─────────────────────────────────────────────────────────────────────────────
// parseAndValidate (unit tests — no AI call)
// ─────────────────────────────────────────────────────────────────────────────
describe("parseAndValidate", () => {
  it("should parse a complete valid listing JSON", () => {
    const json = JSON.stringify({
      title: "Kos Putri AC WiFi Dekat UGM",
      price_monthly: 800000,
      property_type: "kos_putri",
      area_tag: "Kaliurang KM 7",
      facilities: ["ac", "wifi", "kamar mandi dalam", "kasur"],
      contact_wa: "08123456789",
      is_undervalued: false,
      ai_summary: "Kos putri dekat UGM dengan fasilitas lengkap, harga 800rb/bulan.",
    });

    const result = parseAndValidate(json);
    expect(result).not.toBeNull();
    expect(result!.title).toBe("Kos Putri AC WiFi Dekat UGM");
    expect(result!.price_monthly).toBe(800000);
    expect(result!.property_type).toBe("kos_putri");
    expect(result!.area_tag).toBe("Kaliurang KM 7");
    expect(result!.facilities).toEqual(["ac", "wifi", "kamar mandi dalam", "kasur"]);
    // contact_wa should be normalized to 62xxx format
    expect(result!.contact_wa).toBe("628123456789");
    expect(result!.is_undervalued).toBe(false);
    expect(result!.ai_summary).toContain("Kos putri");
  });

  it("should normalize 08xx contact to 62xxx", () => {
    const json = JSON.stringify({
      title: "Kos Murah",
      price_monthly: 500000,
      property_type: "kos_campur",
      area_tag: null,
      facilities: [],
      contact_wa: "08123456789",
      is_undervalued: false,
      ai_summary: "Kos murah di area strategis.",
    });

    const result = parseAndValidate(json);
    expect(result).not.toBeNull();
    expect(result!.contact_wa).toBe("628123456789");
  });

  it("should normalize +628xx contact to 62xxx", () => {
    const json = JSON.stringify({
      title: "Kos Murah",
      price_monthly: 500000,
      property_type: "kos_putra",
      area_tag: null,
      facilities: [],
      contact_wa: "+628123456789",
      is_undervalued: false,
      ai_summary: "Kos putra murah.",
    });

    const result = parseAndValidate(json);
    expect(result).not.toBeNull();
    expect(result!.contact_wa).toBe("628123456789");
  });

  it("should handle null contact_wa", () => {
    const json = JSON.stringify({
      title: "Kos Murah Tanpa Kontak",
      price_monthly: 600000,
      property_type: null,
      area_tag: null,
      facilities: ["wifi"],
      contact_wa: null,
      is_undervalued: false,
      ai_summary: "Kos murah tanpa kontak WA.",
    });

    const result = parseAndValidate(json);
    expect(result).not.toBeNull();
    expect(result!.contact_wa).toBeNull();
  });

  it("should handle null price_monthly", () => {
    const json = JSON.stringify({
      title: "Kos Harga Nego",
      price_monthly: null,
      property_type: "kos_campur",
      area_tag: "Seturan",
      facilities: ["ac"],
      contact_wa: "08123456789",
      is_undervalued: false,
      ai_summary: "Kos campur di Seturan, harga nego.",
    });

    const result = parseAndValidate(json);
    expect(result).not.toBeNull();
    expect(result!.price_monthly).toBeNull();
  });

  it("should return null for invalid JSON", () => {
    const result = parseAndValidate("not valid json{{{");
    expect(result).toBeNull();
  });

  it("should return null for empty JSON object", () => {
    const result = parseAndValidate("{}");
    expect(result).toBeNull();
  });

  it("should return null for missing required fields", () => {
    const json = JSON.stringify({
      title: "Kos",
      // missing other required fields
    });
    const result = parseAndValidate(json);
    expect(result).toBeNull();
  });

  it("should return null if title is too short", () => {
    const json = JSON.stringify({
      title: "ab", // min 3
      price_monthly: 500000,
      property_type: null,
      area_tag: null,
      facilities: [],
      contact_wa: null,
      is_undervalued: false,
      ai_summary: "Summary.",
    });
    const result = parseAndValidate(json);
    expect(result).toBeNull();
  });

  it("should handle is_undervalued = true", () => {
    const json = JSON.stringify({
      title: "Kos Super Murah Below Market",
      price_monthly: 300000,
      property_type: "kos_campur",
      area_tag: "Babarsari",
      facilities: ["ac", "wifi", "kasur"],
      contact_wa: "08123456789",
      is_undervalued: true,
      ai_summary: "Kos harga di bawah rata-rata area Babarsari.",
    });

    const result = parseAndValidate(json);
    expect(result).not.toBeNull();
    expect(result!.is_undervalued).toBe(true);
  });

  it("should handle all property_type variants", () => {
    for (const pt of ["kos_putra", "kos_putri", "kos_campur", "oper_kontrak"]) {
      const json = JSON.stringify({
        title: `Test ${pt}`,
        price_monthly: 500000,
        property_type: pt,
        area_tag: null,
        facilities: [],
        contact_wa: null,
        is_undervalued: false,
        ai_summary: `Test listing ${pt}.`,
      });
      const result = parseAndValidate(json);
      expect(result).not.toBeNull();
      expect(result!.property_type).toBe(pt);
    }
  });

  it("should return null for invalid property_type", () => {
    const json = JSON.stringify({
      title: "Test Invalid Type",
      price_monthly: 500000,
      property_type: "apartemen", // not in enum
      area_tag: null,
      facilities: [],
      contact_wa: null,
      is_undervalued: false,
      ai_summary: "Test.",
    });
    const result = parseAndValidate(json);
    expect(result).toBeNull();
  });

  it("should handle negative price as invalid", () => {
    const json = JSON.stringify({
      title: "Test Negative Price",
      price_monthly: -100000,
      property_type: null,
      area_tag: null,
      facilities: [],
      contact_wa: null,
      is_undervalued: false,
      ai_summary: "Invalid price.",
    });
    const result = parseAndValidate(json);
    expect(result).toBeNull();
  });

  it("should set default facilities to empty array when missing", () => {
    const json = JSON.stringify({
      title: "Kos No Facilities Field",
      price_monthly: 500000,
      property_type: null,
      area_tag: null,
      contact_wa: null,
      is_undervalued: false,
      ai_summary: "No facilities.",
    });
    const result = parseAndValidate(json);
    // Missing 'facilities' field should default to []
    if (result) {
      expect(result.facilities).toEqual([]);
    }
  });

  it("should default new price-quality fields for legacy AI output", () => {
    const json = JSON.stringify({
      title: "Kos Lama Tanpa Field Baru",
      price_monthly: 700000,
      property_type: "kos_campur",
      area_tag: "Seturan",
      facilities: [],
      contact_wa: null,
      is_undervalued: false,
      ai_summary: "Data lama.",
    });

    const result = parseAndValidate(json);
    expect(result).not.toBeNull();
    expect(result!.price_period).toBeNull();
    expect(result!.price_total).toBeNull();
    expect(result!.deposit_idr).toBeNull();
    expect(result!.room_size_m2).toBeNull();
    expect(result!.is_negotiable).toBe(false);
  });

  it("should reject invalid WA number format", () => {
    const json = JSON.stringify({
      title: "Kos Invalid WA",
      price_monthly: 500000,
      property_type: null,
      area_tag: null,
      facilities: [],
      contact_wa: "12345", // not valid Indonesian number
      is_undervalued: false,
      ai_summary: "Invalid WA.",
    });
    const result = parseAndValidate(json);
    expect(result).not.toBeNull();
    // normalizeWA should return null for invalid number
    expect(result!.contact_wa).toBeNull();
  });
});

describe("parseHeuristic", () => {
  it("mengekstrak harga bulanan dan sinyal harga tambahan", () => {
    const result = parseHeuristic(
      "Kos putri Grendeng, 800rb/bulan, AC, WiFi, kamar mandi dalam. WA 081234567890"
    );

    expect(result).not.toBeNull();
    expect(result!.price_monthly).toBe(800_000);
    expect(result!.price_period).toBe("month");
    expect(result!.contact_wa).toBe("6281234567890");
    expect(result!.is_undervalued).toBe(false);
  });

  it("menormalkan oper kontrak total menjadi ekuivalen bulanan", () => {
    const result = parseHeuristic(
      "Oper kontrak kos putra Karangwangkal, 2,4jt sisa 5 bulan. WA 081234567890"
    );

    expect(result).not.toBeNull();
    expect(result!.price_monthly).toBe(480_000);
    expect(result!.price_total).toBe(2_400_000);
    expect(result!.property_type).toBe("oper_kontrak");
  });

  it("membaca ukuran kamar dan status nego", () => {
    const result = parseHeuristic(
      "Kos campur 3x4 m, harga 700rb nego, WiFi. WA 081234567890"
    );

    expect(result).not.toBeNull();
    expect(result!.room_size_m2).toBe(12);
    expect(result!.is_negotiable).toBe(true);
  });

  it("mengekstrak detail kamar, aturan, dan ketersediaan", () => {
    const result = parseHeuristic(
      "Kos putri Jl. Soekarno Hatta Gg. 4 RT 2/RW 5 dekat UB. 800rb/bulan, KM dalam, listrik token, air PDAM, minimal 3 bulan, bisa masuk sekarang, jam malam 22.00, tidak boleh bawa tamu. WA 081234567890",
      { now: new Date("2026-11-19T00:00:00Z") }
    );

    expect(result).not.toBeNull();
    expect(result!.address_detail).toContain("Jl. Soekarno Hatta");
    expect(result!.bathroom_type).toBe("dalam");
    expect(result!.electricity).toBe("token");
    expect(result!.water).toBe("pdam");
    expect(result!.min_stay_months).toBe(3);
    expect(result!.available_from).toBe("2026-11-19");
    expect(result!.rules).toEqual({ has_curfew: true, guests_allowed: false });
    expect(result!.nearby_landmarks).toEqual(["UB"]);
  });

  it("tidak lagi menulis nomor WA ke ai_summary", () => {
    const result = parseHeuristic("Kos putra 700rb/bulan, WiFi. WA 081234567890");

    expect(result).not.toBeNull();
    expect(result!.contact_wa).toBe("6281234567890");
    expect(result!.ai_summary).not.toMatch(/0812|62812/);
  });
});
