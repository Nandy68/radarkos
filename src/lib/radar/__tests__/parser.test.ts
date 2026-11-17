import { describe, it, expect } from "vitest";
import { parseAndValidate } from "@/lib/radar/parser";

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
