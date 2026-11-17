/**
 * KosRadar — Normalisasi Harga
 *
 * Postingan kos di internet datang dalam format yang sangat liar:
 *   "800rb/bln", "1,2jt per bulan", "Rp 1.500.000", "2,4jt sisa 5 bulan",
 *   "650 ribu", "ambil 3 bulan 1,8jt", "deposit 500rb".
 *
 * Modul ini mengubah semuanya menjadi SATU angka pembanding yang adil:
 * harga sewa bulanan (monthly equivalent), sekaligus menandai deposit,
 * periode sewa, dan total kontrak. Parser deterministik ini juga dipakai
 * untuk cross-check hasil ekstraksi LLM — kalau keduanya berbeda jauh,
 * harga tidak dipercaya penuh oleh mesin valuasi.
 */

export type PricePeriod = "month" | "year" | "semester" | "week" | "day" | "unknown";

export interface PriceCandidate {
  /** Potongan teks asli, mis. "Rp 2,4jt". */
  raw: string;
  /** Nominal yang tertulis (belum dinormalisasi ke bulanan). */
  amount: number;
  /** Ekuivalen bulanan. */
  monthly: number;
  period: PricePeriod;
  /** true jika nominal adalah harga total untuk beberapa bulan. */
  isTotal: boolean;
  /** Jumlah bulan jika harga total. */
  months: number | null;
  isDeposit: boolean;
  isPhone: boolean;
  /** Skor keyakinan deterministik (bukan 0..1). */
  score: number;
  index: number;
}

export interface PriceSignal {
  monthly: number | null;
  raw: string | null;
  period: PricePeriod;
  is_total: boolean;
  deposit: number | null;
  negotiable: boolean;
  /** 0..1 — dipakai valuation engine untuk menurunkan confidence. */
  confidence: number;
  candidates: PriceCandidate[];
  flags: string[];
}

export interface AiPriceHint {
  price_monthly?: number | null;
  price_raw?: string | null;
  price_period?: PricePeriod | null;
  price_total?: number | null;
  deposit_idr?: number | null;
}

const MIN_MONTHLY = 50_000;
const MAX_MONTHLY = 100_000_000;

const PRICE_TOKEN =
  /(?:rp\.?\s*)?(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?)\s*(rb|ribu|k|jt|juta|m|miliar)?(?![a-z])/gi;

const PRICE_WORD =
  /\b(harga|sewa|biaya|tarif|per\s*bulan|bulanan|per\s*tahun|tahunan|deposit|uang\s*muka|dp)\b/i;

const DEPOSIT_WORD = /(?:deposit|uang\s*muka|uang\s*jaminan|jaminan|\bdp\b)\s*[:.\-]?\s*$/i;

const PHONE_WORD =
  /\b(?:wa|whatsapp|hp|telp|telepon|tlp|kontak|hubungi|hub)\b\s*[:.\-]?\s*$/i;

function parseNumeric(raw: string): number {
  const s = raw.trim();
  if (!s) return NaN;

  const parts = s.split(/[.,]/);
  if (parts.length === 1) return Number(s);

  const last = parts[parts.length - 1];
  const head = parts.slice(0, -1).join("");
  // "1,2" / "1.5" → desimal; "1.200" / "1,200" → pemisah ribuan.
  if (last.length <= 2) return Number(`${head}.${last}`);
  return Number(`${head}${last}`);
}

function amountFromUnit(amount: number, unit: string | undefined): number {
  if (!unit) return amount;
  switch (unit.toLowerCase()) {
    case "rb":
    case "ribu":
    case "k":
      return amount * 1_000;
    case "jt":
    case "juta":
      return amount * 1_000_000;
    case "m":
    case "miliar":
      return amount * 1_000_000_000;
    default:
      return amount;
  }
}

function periodFromText(context: string): {
  period: PricePeriod;
  explicit: boolean;
  months: number | null;
  isTotal: boolean;
} {
  // Kontrak total: "sisa 5 bulan", "untuk 6 bulan", "take over 8 bln".
  const duration =
    context.match(
      /(?:sisa|selama|untuk|masa|kontrak|paket|ambil)\s*(?:\(?\s*)?(\d{1,2})\s*(bulan|bln|tahun|thn)/i
    ) ||
    context.match(/(\d{1,2})\s*(bulan|bln)\s*(?:lagi|ke\s*depan|kedepan)/i);

  if (duration) {
    const count = Number(duration[1]);
    const unit = duration[2].toLowerCase();
    if (Number.isFinite(count) && count > 0) {
      return {
        period: unit.startsWith("tahun") || unit === "thn" ? "year" : "month",
        explicit: true,
        months: unit.startsWith("tahun") || unit === "thn" ? count * 12 : count,
        isTotal: true,
      };
    }
  }

  if (/(?:per|\/|tiap|se)\s*(?:bulan|bln)|\bbulanan\b/i.test(context)) {
    return { period: "month", explicit: true, months: null, isTotal: false };
  }
  if (/(?:per|\/|tiap|se)\s*(?:tahun|thn)|\btahunan\b/i.test(context)) {
    return { period: "year", explicit: true, months: null, isTotal: false };
  }
  if (/(?:per|\/|tiap|se)\s*(?:semester|smstr)|\bsemesteran\b/i.test(context)) {
    return { period: "semester", explicit: true, months: null, isTotal: false };
  }
  if (/(?:per|\/|tiap|se)\s*(?:minggu|mgg)|\bmingguan\b/i.test(context)) {
    return { period: "week", explicit: true, months: null, isTotal: false };
  }
  if (/(?:per|\/|tiap|se)\s*(?:hari|hr)|\bharian\b/i.test(context)) {
    return { period: "day", explicit: true, months: null, isTotal: false };
  }

  // Default postingan kos adalah bulanan, tetapi tidak dianggap eksplisit.
  return { period: "unknown", explicit: false, months: null, isTotal: false };
}

function toMonthly(
  amount: number,
  period: PricePeriod,
  isTotal: boolean,
  months: number | null
): number {
  if (isTotal && months && months > 0) return amount / months;
  switch (period) {
    case "year":
      return amount / 12;
    case "semester":
      return amount / 6;
    case "week":
      return (amount * 30) / 7;
    case "day":
      return amount * 30;
    case "month":
    case "unknown":
    default:
      return amount;
  }
}

/**
 * Ekstrak sinyal harga dari teks mentah.
 * `ai` opsional untuk rekonsiliasi dua mesin ekstraksi (deterministik + LLM).
 */
export function extractPriceSignal(text: string, ai?: AiPriceHint): PriceSignal {
  const candidates: PriceCandidate[] = [];
  const flags: string[] = [];

  PRICE_TOKEN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PRICE_TOKEN.exec(text)) !== null) {
    const raw = match[0].trim();
    const numRaw = match[1];
    const unit = match[2];
    const index = match.index;

    const before = text.slice(Math.max(0, index - 40), index).toLowerCase();
    const after = text.slice(PRICE_TOKEN.lastIndex, PRICE_TOKEN.lastIndex + 50).toLowerCase();
    const context = `${before} ${after}`;

    const hasCurrency = /^rp\.?\s*/i.test(raw);
    const amount = amountFromUnit(parseNumeric(numRaw), unit);
    if (!Number.isFinite(amount) || amount <= 0) continue;

    const isPhone =
      PHONE_WORD.test(before) ||
      (!unit && !hasCurrency && /^0?8\d{8,}$/.test(numRaw.replace(/[.,]/g, "")));
    const isDeposit = DEPOSIT_WORD.test(before) || /^\s*(?:deposit|dp|jaminan)\b/.test(after);
    const priceWord = PRICE_WORD.test(before) || /^\s*(?:per|\/)\s*(?:bulan|bln)/.test(after);
    const periodInfo = periodFromText(context);

    // Angka tanpa satuan / Rp hanya diterima kalau ada konteks harga.
    if (!unit && !hasCurrency && !priceWord && !isDeposit) continue;

    let value = amount;
    // "harga 800" / "sewa 650" → 800rb / 650rb.
    if (!unit && !hasCurrency && value >= 100 && value < 10_000 && priceWord) {
      value *= 1_000;
    }

    const monthly = toMonthly(value, periodInfo.period, periodInfo.isTotal, periodInfo.months);
    if (!Number.isFinite(monthly) || monthly <= 0) continue;
    if (monthly < MIN_MONTHLY || monthly > MAX_MONTHLY) continue;

    let score = 0;
    if (hasCurrency) score += 4;
    if (unit) score += 2;
    if (priceWord) score += 3;
    if (periodInfo.explicit) score += 3;
    if (periodInfo.isTotal) score += 1;
    if (isPhone) score -= 12;
    if (isDeposit) score -= 10;
    if (value < 10_000) score -= 3;

    // Angka yang persis menempel pada kata "harga" lebih relevan.
    if (/(?:harga|sewa|biaya|tarif)\s*[:.\-]?\s*(?:rp\.?\s*)?$/i.test(before)) score += 2;

    candidates.push({
      raw,
      amount: value,
      monthly: Math.round(monthly / 1_000) * 1_000,
      period: periodInfo.period,
      isTotal: periodInfo.isTotal,
      months: periodInfo.months,
      isDeposit,
      isPhone,
      score,
      index,
    });
  }

  const valid = candidates
    .filter((c) => !c.isDeposit && !c.isPhone)
    .sort((a, b) => b.score - a.score || a.index - b.index);
  const best = valid[0] ?? null;

  const deposit =
    candidates
      .filter((c) => c.isDeposit)
      .sort((a, b) => b.score - a.score)[0]?.amount ?? null;

  const negotiable = /\b(?:nego|negotiable|bisa\s*nego|masih\s*nego|nett?)\b/i.test(text);

  const localMonthly = best?.monthly ?? null;
  let localConfidence = 0;
  if (best) {
    localConfidence =
      0.34 +
      (best.amount !== best.monthly || best.isTotal ? 0.12 : 0) +
      (best.period !== "unknown" ? 0.1 : 0) +
      Math.min(0.18, Math.max(0, best.score) * 0.018) +
      (best.isTotal ? 0.06 : 0);

    // Dua kandidat yang saling mendukung menaikkan keyakinan.
    const agreeing = valid.filter(
      (c) => Math.abs(c.monthly - best.monthly) / best.monthly <= 0.12
    ).length;
    if (agreeing >= 2) localConfidence += 0.12;
  }

  let monthly = localMonthly;
  let confidence = localConfidence;
  let raw = best?.raw ?? null;
  let period = best?.period ?? "unknown";
  let is_total = best?.isTotal ?? false;

  const aiMonthly =
    typeof ai?.price_monthly === "number" && ai.price_monthly > 0
      ? ai.price_monthly
      : null;

  if (aiMonthly != null) {
    if (localMonthly != null) {
      const ratio = aiMonthly / localMonthly;
      if (ratio >= 0.82 && ratio <= 1.22) {
        confidence = Math.max(confidence, 0.78) + 0.12;
      } else {
        flags.push("price_conflict");
        // Harga lokal dengan satuan/format mata uang + periode eksplisit
        // lebih bisa diaudit daripada tebakan LLM.
        if ((best?.score ?? 0) >= 5) {
          confidence = Math.max(0.5, localConfidence - 0.1);
        } else {
          monthly = aiMonthly;
          confidence = 0.48;
        }
      }
    } else {
      monthly = aiMonthly;
      raw = ai?.price_raw ?? raw;
      period = ai?.price_period ?? period;
      is_total = ai?.price_total != null;
      confidence = 0.56;
    }
  }

  if (monthly == null) {
    flags.push("price_missing");
    confidence = 0;
  } else {
    confidence = Math.max(0.2, Math.min(0.97, confidence));
  }

  if (deposit != null) flags.push("deposit_present");
  if (negotiable) flags.push("negotiable");
  if (best?.period === "unknown") flags.push("period_unclear");

  return {
    monthly,
    raw,
    period,
    is_total,
    deposit,
    negotiable,
    confidence,
    candidates: candidates.sort((a, b) => a.index - b.index),
    flags,
  };
}

/**
 * Ukuran kamar dari teks ("3x4", "3 x 4 m", "12 m2").
 * Mengembalikan luas dalam m² atau null.
 */
export function extractRoomSizeM2(text: string): number | null {
  const dimensions = text.match(
    /(\d{1,2}(?:[.,]\d+)?)\s*[x×]\s*(\d{1,2}(?:[.,]\d+)?)\s*(?:m(?:eter)?|m2|m²)?/i
  );
  if (dimensions) {
    const w = Number(dimensions[1].replace(",", "."));
    const l = Number(dimensions[2].replace(",", "."));
    const area = w * l;
    if (Number.isFinite(area) && area >= 4 && area <= 100) return area;
  }

  const direct = text.match(/(\d{1,2}(?:[.,]\d+)?)\s*(?:m2|m²|meter\s*persegi)\b/i);
  if (direct) {
    const area = Number(direct[1].replace(",", "."));
    if (Number.isFinite(area) && area >= 4 && area <= 100) return area;
  }

  return null;
}
