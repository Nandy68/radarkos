import { describe, it, expect } from "vitest";
import {
  cleanText,
  hasHousingKeyword,
  isSpam,
  extractContactHint,
  createSourceHash,
  prefilter,
} from "@/lib/radar/prefilter";

// ─────────────────────────────────────────────────────────────────────────────
// cleanText
// ─────────────────────────────────────────────────────────────────────────────
describe("cleanText", () => {
  it("should trim whitespace", () => {
    expect(cleanText("  hello world  ")).toBe("hello world");
  });

  it("should collapse multiple spaces to single space", () => {
    expect(cleanText("hello    world")).toBe("hello world");
  });

  it("should collapse multiple newlines to max 2", () => {
    expect(cleanText("hello\n\n\n\n\nworld")).toBe("hello\n\nworld");
  });

  it("should remove zero-width characters", () => {
    expect(cleanText("hello\u200Bworld")).toBe("helloworld");
  });

  it("should normalize CRLF to LF", () => {
    expect(cleanText("hello\r\nworld")).toBe("hello\nworld");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// hasHousingKeyword
// ─────────────────────────────────────────────────────────────────────────────
describe("hasHousingKeyword", () => {
  it("should match 'kos'", () => {
    expect(hasHousingKeyword("Ada kamar kos di daerah Gejayan")).toBe(true);
  });

  it("should match 'kost' (with t)", () => {
    expect(hasHousingKeyword("Kost putri Jl. Kaliurang")).toBe(true);
  });

  it("should match 'kostan'", () => {
    expect(hasHousingKeyword("kostan murah dekat UGM")).toBe(true);
  });

  it("should match 'oper kontrak'", () => {
    expect(hasHousingKeyword("Oper kontrak kamar di Condongcatur")).toBe(true);
  });

  it("should match 'oper kontrak' with extra space", () => {
    expect(hasHousingKeyword("oper  kontrak apartemen")).toBe(true);
  });

  it("should match 'kamar kosong'", () => {
    expect(hasHousingKeyword("kamar kosong 1 siap huni")).toBe(true);
  });

  it("should match 'kontrakan'", () => {
    expect(hasHousingKeyword("kontrakan 2 kamar di Depok")).toBe(true);
  });

  it("should match 'sewa kamar'", () => {
    expect(hasHousingKeyword("sewa kamar bulanan murah")).toBe(true);
  });

  it("should match 'indekos'", () => {
    expect(hasHousingKeyword("indekos mahasiswa putri")).toBe(true);
  });

  it("should match 'rumah kos'", () => {
    expect(hasHousingKeyword("rumah kos eksklusif Jogja")).toBe(true);
  });

  it("should NOT match unrelated text", () => {
    expect(hasHousingKeyword("jual laptop murah")).toBe(false);
  });

  it("should NOT match 'kosmetik' (false positive guard)", () => {
    // 'kosmetik' contains 'kos' but our regex uses word boundary \b
    expect(hasHousingKeyword("jual kosmetik murah")).toBe(false);
  });

  it("should be case insensitive", () => {
    expect(hasHousingKeyword("KOS PUTRA MURAH")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// isSpam
// ─────────────────────────────────────────────────────────────────────────────
describe("isSpam", () => {
  it("should detect gambling spam", () => {
    expect(isSpam("kos murah slot gacor hari ini")).toBe(true);
  });

  it("should detect pinjol spam", () => {
    expect(isSpam("kos murah pinjaman online cair cepat")).toBe(true);
  });

  it("should detect 'klik di sini' spam", () => {
    expect(isSpam("kos murah klik di sini untuk daftar")).toBe(true);
  });

  it("should detect excessive URLs", () => {
    const text = "kos murah " + "http://a.com ".repeat(6);
    expect(isSpam(text)).toBe(true);
  });

  it("should detect character repetition spam", () => {
    expect(isSpam("kos murah " + "a".repeat(15))).toBe(true);
  });

  it("should NOT flag normal listing", () => {
    expect(
      isSpam(
        "Kos putri di Jl. Kaliurang KM 7, harga 800rb/bulan, AC, wifi, kamar mandi dalam. WA 08123456789"
      )
    ).toBe(false);
  });

  it("should detect crypto trading spam", () => {
    expect(isSpam("kos murah crypto trading profit 100%")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// extractContactHint
// ─────────────────────────────────────────────────────────────────────────────
describe("extractContactHint", () => {
  it("should extract 08xx number", () => {
    expect(extractContactHint("hubungi 08123456789 sekarang")).toBe(
      "08123456789"
    );
  });

  it("should extract +628xx number", () => {
    expect(extractContactHint("WA: +6281234567890")).toBe("+6281234567890");
  });

  it("should extract 628xx number", () => {
    expect(extractContactHint("kontak 6281234567890")).toBe("6281234567890");
  });

  it("should extract number with dashes", () => {
    expect(extractContactHint("WA 0812-3456-789")).toBe("08123456789");
  });

  it("should extract number with spaces", () => {
    expect(extractContactHint("WA 0812 3456 789")).toBe("08123456789");
  });

  it("should return null for no number", () => {
    expect(extractContactHint("kos murah di Jogja")).toBe(null);
  });

  it("should return first number if multiple", () => {
    const result = extractContactHint("WA 08111111111 atau 08222222222");
    expect(result).toBe("08111111111");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createSourceHash
// ─────────────────────────────────────────────────────────────────────────────
describe("createSourceHash", () => {
  it("should return a 64-char hex string", async () => {
    const hash = await createSourceHash("kos murah", "08123456789");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("should produce deterministic output", async () => {
    const a = await createSourceHash("kos murah", "08123456789");
    const b = await createSourceHash("kos murah", "08123456789");
    expect(a).toBe(b);
  });

  it("should differ for different text", async () => {
    const a = await createSourceHash("kos murah", "08123456789");
    const b = await createSourceHash("kos mahal", "08123456789");
    expect(a).not.toBe(b);
  });

  it("should differ for different contact", async () => {
    const a = await createSourceHash("kos murah", "08111111111");
    const b = await createSourceHash("kos murah", "08222222222");
    expect(a).not.toBe(b);
  });

  it("should handle null contact", async () => {
    const hash = await createSourceHash("kos murah", null);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("should be case insensitive", async () => {
    const a = await createSourceHash("Kos Murah", null);
    const b = await createSourceHash("kos murah", null);
    expect(a).toBe(b);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// prefilter (integration)
// ─────────────────────────────────────────────────────────────────────────────
describe("prefilter", () => {
  it("should reject text that is too short", async () => {
    const result = await prefilter("kos murah");
    expect(result.passed).toBe(false);
    expect(result.reason).toBe("too_short");
  });

  it("should reject text without housing keywords", async () => {
    const result = await prefilter(
      "Jual laptop bekas murah banget harga miring siapa cepat dia dapat"
    );
    expect(result.passed).toBe(false);
    expect(result.reason).toBe("no_keyword");
  });

  it("should reject spam even with housing keyword", async () => {
    const result = await prefilter(
      "Kos murah banget slot gacor hari ini pasti menang"
    );
    expect(result.passed).toBe(false);
    expect(result.reason).toBe("spam");
  });

  it("should pass valid listing text", async () => {
    const result = await prefilter(
      "Kos putri di Jl. Kaliurang KM 7, harga 800rb/bulan, AC, wifi, kamar mandi dalam. WA 08123456789"
    );
    expect(result.passed).toBe(true);
    expect(result.cleaned_text).toBeDefined();
    expect(result.source_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.contact_hint).toBe("08123456789");
  });

  it("should pass valid oper kontrak text", async () => {
    const result = await prefilter(
      "Oper kontrak kamar di Condongcatur Sleman, sisa 6 bulan, harga 3jt. Fasilitas lengkap. Hub 081234567890"
    );
    expect(result.passed).toBe(true);
    expect(result.source_hash).toBeDefined();
  });

  it("should produce different hash for different texts", async () => {
    const a = await prefilter(
      "Kos putra di Babarsari harga 700rb AC wifi. WA 08111111111"
    );
    const b = await prefilter(
      "Kos putri di Seturan harga 900rb AC wifi. WA 08222222222"
    );
    expect(a.passed).toBe(true);
    expect(b.passed).toBe(true);
    expect(a.source_hash).not.toBe(b.source_hash);
  });

  it("should handle messy text with extra whitespace", async () => {
    const result = await prefilter(
      "   Kos   murah   di   Jogja   harga   500rb   AC   wifi   WA 08123456789   "
    );
    expect(result.passed).toBe(true);
    expect(result.cleaned_text).not.toContain("  "); // no double spaces
  });
});
