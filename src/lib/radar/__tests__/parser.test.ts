import { describe, it, expect } from "vitest";
import type OpenAI from "openai";
import {
  needsAiEnrichment,
  parseAndValidate,
  parseHeuristic,
  parseListingBatch,
} from "@/lib/radar/parser";

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

  it("memvalidasi field detail baru dari AI", () => {
    const json = JSON.stringify({
      title: "Kos Putri Melati",
      price_monthly: 800000,
      property_type: "kos_putri",
      area_tag: "Lowokwaru",
      facilities: ["ac"],
      contact_wa: null,
      is_undervalued: false,
      ai_summary: "Kos putri di Lowokwaru.",
      address_detail: "Jl. Soekarno Hatta Gg. 4",
      bathroom_type: "dalam",
      electricity: "token",
      water: "pdam",
      min_stay_months: 3,
      available_from: "2026-12-01",
      rules: { has_curfew: true },
      nearby_landmarks: ["UB"],
      landlord_name: "Bu Sri",
      landlord_type: "pemilik",
      maps_url: "https://maps.google.com/?q=-7.9,112.6",
    });

    const result = parseAndValidate(json);
    expect(result).not.toBeNull();
    expect(result!.bathroom_type).toBe("dalam");
    expect(result!.electricity).toBe("token");
    expect(result!.water).toBe("pdam");
    expect(result!.min_stay_months).toBe(3);
    expect(result!.available_from).toBe("2026-12-01");
    expect(result!.rules).toEqual({ has_curfew: true });
    expect(result!.nearby_landmarks).toEqual(["UB"]);
  });

  it("memberi default untuk output AI lama tanpa field detail", () => {
    const json = JSON.stringify({
      title: "Kos Lama",
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
    expect(result!.address_detail).toBeNull();
    expect(result!.bathroom_type).toBeNull();
    expect(result!.rules).toEqual({});
    expect(result!.nearby_landmarks).toEqual([]);
    expect(result!.gender_type).toBeNull();
    expect(result!.billing_cycle).toBeNull();
    expect(result!.electricity_included).toBe(false);
    expect(result!.price_yearly).toBeNull();
    expect(result!.takeover_price).toBeNull();
  });

  it("membaca harga tahunan menjadi bulanan + billing cycle", () => {
    const result = parseAndValidate(
      JSON.stringify({
        title: "Kos Putri Tahunan",
        price_monthly: 500000,
        price_yearly: 6000000,
        billing_cycle: "Tahunan",
        property_type: "kos_putri",
        area_tag: "Lowokwaru",
        facilities: [],
        contact_wa: null,
        is_undervalued: false,
        ai_summary: "Tahunan.",
      })
    );

    expect(result).not.toBeNull();
    expect(result!.price_monthly).toBe(500000);
    expect(result!.price_yearly).toBe(6000000);
    expect(result!.billing_cycle).toBe("Tahunan");
  });

  it("membaca oper kontrak takeover + sisa bulan", () => {
    const result = parseAndValidate(
      JSON.stringify({
        title: "Oper Kontrak 5 Bulan",
        price_monthly: 480000,
        takeover_price: 2400000,
        remaining_months: 5,
        listing_type: "Oper Kontrak",
        billing_cycle: "Sisa Kontrak",
        property_type: "oper_kontrak",
        area_tag: "Grendeng",
        facilities: [],
        contact_wa: null,
        is_undervalued: false,
        ai_summary: "Takeover.",
      })
    );

    expect(result).not.toBeNull();
    expect(result!.takeover_price).toBe(2400000);
    expect(result!.remaining_months).toBe(5);
    expect(result!.listing_type).toBe("Oper Kontrak");
    expect(result!.billing_cycle).toBe("Sisa Kontrak");
  });

  it("tidak membuang hasil valid saat satu field detail rusak", () => {
    const json = JSON.stringify({
      title: "Kos Rusak Sebagian",
      price_monthly: 700000,
      property_type: "kos_campur",
      area_tag: "Seturan",
      facilities: [],
      contact_wa: null,
      is_undervalued: false,
      ai_summary: "Data.",
      rules: { has_curfew: "ya" },
    });

    const result = parseAndValidate(json);
    expect(result).not.toBeNull();
    expect(result!.price_monthly).toBe(700000);
    expect(result!.rules).toEqual({});
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

describe("needsAiEnrichment", () => {
  it("tidak memanggil AI untuk post yang sudah lengkap", () => {
    const parsed = parseHeuristic("Kos putri Grendeng 800rb/bln, WiFi");
    expect(parsed).not.toBeNull();
    expect(needsAiEnrichment(parsed!)).toBe(false);
  });

  it("memanggil AI saat harga tidak terbaca", () => {
    const parsed = parseHeuristic("Kos putri, harga nego, WiFi");
    expect(needsAiEnrichment(parsed!)).toBe(true);
  });

  it("memanggil AI saat area masih generik", () => {
    const parsed = parseHeuristic("Kos putri 800rb/bln, WiFi");
    expect(needsAiEnrichment(parsed!)).toBe(true);
  });
});

describe("parseListingBatch", () => {
  function batchClient(payload: unknown, usage: unknown = { prompt_tokens: 120, completion_tokens: 60 }) {
    return {
      chat: {
        completions: {
          create: async () => ({
            choices: [{ message: { content: JSON.stringify(payload) } }],
            usage,
          }),
        },
      },
    } as unknown as OpenAI;
  }

  const item = (index: number, title: string) => ({
    index,
    title,
    price_monthly: 800000,
    property_type: "kos_putri",
    area_tag: "Lowokwaru",
    facilities: [],
    contact_wa: null,
    is_undervalued: false,
    ai_summary: title,
  });

  it("memetakan item berdasarkan index, bukan urutan array", async () => {
    const out = await parseListingBatch(["post A", "post B"], {
      client: batchClient({ items: [item(1, "Kos B"), item(0, "Kos A")] }),
    });

    expect(out.items).toHaveLength(2);
    expect(out.items[0]!.title).toBe("Kos A");
    expect(out.items[1]!.title).toBe("Kos B");
    expect(out.usage).toEqual({ prompt_tokens: 120, completion_tokens: 60 });
  });

  it("membiarkan item yang hilang sebagai null", async () => {
    const out = await parseListingBatch(["post A", "post B"], {
      client: batchClient({ items: [item(0, "Kos A")] }),
    });

    expect(out.items[0]!.title).toBe("Kos A");
    expect(out.items[1]).toBeNull();
  });

  it("memotong teks panjang sebelum dikirim", async () => {
    const calls: { messages: { content: string }[] }[] = [];
    const client = {
      chat: {
        completions: {
          create: async (req: { messages: { content: string }[] }) => {
            calls.push(req);
            return {
              choices: [{ message: { content: JSON.stringify({ items: [item(0, "Kos A")] }) } }],
              usage: { prompt_tokens: 10, completion_tokens: 5 },
            };
          },
        },
      },
    } as unknown as OpenAI;

    const long = "x".repeat(1000) + " kos 800rb";
    await parseListingBatch([long, "post dua"], {
      client,
      maxCharsPerPost: 700,
    });

    const body = JSON.parse(calls[0].messages[1].content) as {
      posts: { index: number; text: string }[];
    };
    expect(body.posts[0].text).toHaveLength(700);
    expect(body.posts[1].text).toBe("post dua");
  });

  it("mengembalikan null semua tanpa client", async () => {
    const previous = process.env.DEEPSEEK_API_KEY;
    process.env.DEEPSEEK_API_KEY = "";
    try {
      const out = await parseListingBatch(["post A"]);
      expect(out.items).toEqual([null]);
      expect(out.usage).toBeNull();
    } finally {
      if (previous === undefined) delete process.env.DEEPSEEK_API_KEY;
      else process.env.DEEPSEEK_API_KEY = previous;
    }
  });
});
