import { describe, it, expect } from "vitest";
import { extractPriceSignal, extractRoomSizeM2 } from "@/lib/radar/pricing";

describe("extractPriceSignal", () => {
  it("membaca format rb/bulan", () => {
    const signal = extractPriceSignal("Kos putri, harga 800rb/bulan, AC, WiFi. WA 081234567890");
    expect(signal.monthly).toBe(800_000);
    expect(signal.period).toBe("month");
    expect(signal.confidence).toBeGreaterThan(0.6);
  });

  it("membaca format juta dengan koma desimal", () => {
    const signal = extractPriceSignal("Kos eksklusif 1,2jt per bulan dekat kampus");
    expect(signal.monthly).toBe(1_200_000);
  });

  it("membaca Rupiah bertitik ribuan", () => {
    const signal = extractPriceSignal("Harga sewa Rp 1.500.000 / bulan, kamar mandi dalam");
    expect(signal.monthly).toBe(1_500_000);
  });

  it("membaca 'ribu' dan konteks harga tanpa satuan", () => {
    expect(extractPriceSignal("Kos murah 650 ribu per bulan").monthly).toBe(650_000);
    expect(extractPriceSignal("Harga 750, dekat kampus").monthly).toBe(750_000);
  });

  it("menormalkan harga total oper kontrak menjadi ekuivalen bulanan", () => {
    const signal = extractPriceSignal(
      "Oper kontrak kamar, harga 2,4jt sisa 5 bulan. Fasilitas lengkap. WA 081234567890"
    );
    expect(signal.is_total).toBe(true);
    expect(signal.monthly).toBe(480_000);
  });

  it("menormalkan sewa tahunan", () => {
    const signal = extractPriceSignal("Kos 12jt per tahun, dekat kampus");
    expect(signal.monthly).toBe(1_000_000);
    expect(signal.period).toBe("year");
  });

  it("memisahkan deposit dari harga sewa", () => {
    const signal = extractPriceSignal(
      "Kos putra 850rb/bulan. Deposit 500rb, bisa nego. WA 081234567890"
    );
    expect(signal.monthly).toBe(850_000);
    expect(signal.deposit).toBe(500_000);
    expect(signal.negotiable).toBe(true);
    expect(signal.flags).toContain("deposit_present");
  });

  it("tidak membaca nomor HP sebagai harga", () => {
    const signal = extractPriceSignal("Kos murah dekat kampus. Hubungi WA 081234567890");
    expect(signal.monthly).toBeNull();
    expect(signal.flags).toContain("price_missing");
  });

  it("tidak membaca ukuran kamar sebagai harga", () => {
    const signal = extractPriceSignal("Kamar kos 3x4 m, ada AC dan WiFi. Harga nego");
    expect(signal.monthly).toBeNull();
  });

  it("memakai hasil AI bila parser deterministik tidak menemukan harga", () => {
    const signal = extractPriceSignal("Kos nyaman dekat kampus, info lengkap via WA 081234567890", {
      price_monthly: 900_000,
      price_raw: "900rb",
    });
    expect(signal.monthly).toBe(900_000);
    expect(signal.confidence).toBeGreaterThan(0.4);
  });

  it("menandai konflik bila AI dan parser berbeda jauh", () => {
    const signal = extractPriceSignal("Kos 1,2jt per bulan, AC, dekat kampus", {
      price_monthly: 450_000,
    });
    expect(signal.monthly).toBe(1_200_000);
    expect(signal.flags).toContain("price_conflict");
  });

  it("menaikkan keyakinan saat dua mesin sepakat", () => {
    const signal = extractPriceSignal("Kos 800rb/bulan dekat kampus", {
      price_monthly: 810_000,
    });
    expect(signal.confidence).toBeGreaterThan(0.85);
  });
});

describe("extractRoomSizeM2", () => {
  it("membaca dimensi kamar", () => {
    expect(extractRoomSizeM2("Kamar 3x4 m, kamar mandi dalam")).toBe(12);
    expect(extractRoomSizeM2("ukuran 3 x 5 meter, AC")).toBe(15);
  });

  it("membaca luas langsung", () => {
    expect(extractRoomSizeM2("Kamar 12 m2 full furnish")).toBe(12);
  });

  it("mengabaikan angka yang bukan ukuran", () => {
    expect(extractRoomSizeM2("Kos dekat kampus, angkatan 2024")).toBeNull();
  });
});
