/**
 * KosRadar — Deal Valuation Engine
 *
 * Mesin penilaian harga pasar yang deterministik dan bisa diaudit.
 * Tujuan: menemukan kamar kos yang benar-benar murah dibanding pasar,
 * bukan sekadar yang harganya kecil.
 *
 * Pipeline:
 *   1. Comparables      — ambil listing sejenis di kota/area yang sama.
 *   2. Similarity       — bobot area, tipe, fasilitas, ukuran, dan umur listing.
 *   3. Robust statistics— weighted median + MAD, tahan terhadap outlier.
 *   4. Hierarchical     — center area di-shrink ke center kota/tipe.
 *   5. Hedonic model    — ridge regression untuk koreksi fasilitas & ukuran.
 *   6. Confidence       — seberapa layak angka pasar ini dipercaya.
 *   7. Risk layer       — deteksi red flag scam, data bolong, listing basi.
 *   8. Deal score       — gabungan diskon, z-score, keyakinan, kesegaran, risiko.
 *
 * Semua perhitungan murni (pure) agar mudah diuji dan dipakai ulang oleh
 * endpoint ingest maupun endpoint feed.
 */

import type { PropertyType } from "./types";

export type DealGrade = "steal" | "underpriced" | "watch" | "fair" | "overpriced" | "unknown";

export interface DealRiskFlag {
  code: string;
  label: string;
  severity: number;
}

export interface DealCandidate {
  id?: string | number;
  title?: string | null;
  price_monthly: number | null;
  property_type: PropertyType | null;
  area_tag: string | null;
  facilities: string[];
  posted_at?: string | null;
  room_size_m2?: number | null;
  raw_text?: string | null;
  ai_summary?: string | null;
  image_urls?: string[];
  source_url?: string | null;
  contact_wa?: string | null;
  /** 0..1 — keyakinan sinyal harga dari modul pricing. */
  price_confidence?: number;
}

export interface DealValuation {
  fair_price_monthly: number | null;
  market_low: number | null;
  market_high: number | null;
  discount_pct: number | null;
  price_z: number | null;
  sample_size: number;
  effective_sample: number;
  confidence: number;
  risk_score: number;
  risk_flags: DealRiskFlag[];
  deal_score: number;
  grade: DealGrade;
  is_undervalued: boolean;
  reasons: string[];
  /** true jika nilai pasar memakai prior kota karena pembanding sedikit. */
  used_prior: boolean;
}

export interface DealPolicy {
  /** Diskon minimum agar dianggap below-market. */
  minDiscountPct: number;
  /** Keyakinan minimum model. */
  minConfidence: number;
  /** Risiko maksimum yang masih boleh tampil sebagai deal. */
  maxRiskScore: number;
  /** Umur pembanding maksimum (hari). */
  maxComparableAgeDays: number;
}

export interface DealEngineOptions extends Partial<DealPolicy> {
  now?: Date;
  /**
   * Harga pasar acuan kota (monthly). Dipakai sebagai pseudo-observation
   * saat pembanding masih sedikit / cold start.
   */
  priorMonthlyPrice?: number | null;
}

export interface RankedDeal<T extends DealCandidate> {
  listing: T;
  valuation: DealValuation;
}

export const DEFAULT_DEAL_POLICY: DealPolicy = {
  minDiscountPct: 12,
  minConfidence: 0.45,
  maxRiskScore: 55,
  maxComparableAgeDays: 365,
};

const MIN_FAIR_PRICE = 75_000;

const TYPE_MULTIPLIER: Record<PropertyType, number> = {
  kos_putra: 0.92,
  kos_putri: 1.06,
  kos_campur: 1.0,
  // Harga oper kontrak dinilai setara sewa normal. Diskon takeover adalah
  // sinyal deal yang ingin dideteksi, bukan baseline pasar.
  oper_kontrak: 1.0,
};

const AREA_STOPWORDS = new Set([
  "dekat",
  "sekitar",
  "area",
  "kampus",
  "ke",
  "dari",
  "dan",
  "yang",
  "di",
  "mnt",
  "menit",
  "jalan",
  "jl",
  "gang",
  "gg",
  "no",
  "nomor",
  "rt",
  "rw",
  "kel",
  "kec",
  "kota",
  "komplek",
  "kompleks",
  "perumahan",
  "blok",
  "dalam",
  "luar",
  "depan",
  "belakang",
  "samping",
  "sebelah",
  "utara",
  "selatan",
  "timur",
  "barat",
  "tengah",
  "km",
  "meter",
  "m",
  "s",
  "d",
  "kamar",
  "kos",
  "kost",
  "kosan",
  "putra",
  "putri",
  "campur",
  "oper",
  "kontrak",
  "mahasiswa",
  "mahasiswi",
]);

const CAMPUS_TOKENS = new Set([
  "ugm",
  "uny",
  "upn",
  "uii",
  "unsoed",
  "ump",
  "telkom",
  "unpad",
  "itb",
  "undip",
  "unnes",
  "udinus",
  "polines",
  "ub",
  "um",
  "umm",
  "uin",
  "unisma",
  "uns",
  "ums",
  "ui",
]);

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function roundTo(value: number, step = 1_000): number {
  return Math.round(value / step) * step;
}

function safeDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function ageInDays(postedAt: string | null | undefined, now: Date): number | null {
  const date = safeDate(postedAt);
  if (!date) return null;
  return Math.max(0, (now.getTime() - date.getTime()) / 86_400_000);
}

function weightedMedian(values: number[], weights: number[]): number | null {
  if (values.length === 0) return null;
  const pairs = values
    .map((value, index) => ({ value, weight: Math.max(0, weights[index] ?? 0) }))
    .sort((a, b) => a.value - b.value);

  const total = pairs.reduce((sum, pair) => sum + pair.weight, 0);
  if (total <= 0) return pairs[Math.floor(pairs.length / 2)].value;

  let cumulative = 0;
  for (const pair of pairs) {
    cumulative += pair.weight;
    if (cumulative >= total / 2) return pair.value;
  }
  return pairs[pairs.length - 1].value;
}

function weightedMad(values: number[], weights: number[], center: number): number {
  if (values.length === 0) return 0.2;
  const deviations = values.map((value) => Math.abs(value - center));
  return weightedMedian(deviations, weights) ?? 0.2;
}

function effectiveSampleSize(weights: number[]): number {
  const sum = weights.reduce((acc, weight) => acc + weight, 0);
  const sumSquares = weights.reduce((acc, weight) => acc + weight * weight, 0);
  if (sumSquares <= 0) return 0;
  return (sum * sum) / sumSquares;
}

function normalizeArea(value: string | null | undefined): string[] {
  if (!value) return [];
  const tokens = value
    .toLowerCase()
    .replace(/[()]/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 0);

  return Array.from(
    new Set(
      tokens.filter(
        (token) =>
          !/^\d+[a-z]*$/.test(token) &&
          (token.length >= 3 || CAMPUS_TOKENS.has(token)) &&
          !AREA_STOPWORDS.has(token)
      )
    )
  );
}

/** Similarity 0..1 antar area/lokasi. */
export function areaSimilarity(a: string | null | undefined, b: string | null | undefined): number {
  const left = normalizeArea(a);
  const right = normalizeArea(b);

  if (left.length === 0 && right.length === 0) return 0.35;
  if (left.length === 0 || right.length === 0) return 0.2;

  const rightSet = new Set(right);
  const intersection = left.filter((token) => rightSet.has(token)).length;
  const union = new Set([...left, ...right]).size;
  const jaccard = union > 0 ? intersection / union : 0;
  // Containment membantu saat satu penulis menambahkan nama kampus/patokan.
  const containment = intersection / Math.max(1, Math.min(left.length, right.length));
  let score = 0.5 * jaccard + 0.5 * containment;

  // Satu nama area sering ditulis dengan suffix berbeda ("Pogung" vs "Pogung Kidul").
  if (score === 0) {
    for (const token of left) {
      if (right.some((other) => other.includes(token) || token.includes(other))) {
        score = 0.75;
        break;
      }
    }
  }

  return clamp(score, 0, 1);
}

interface FacilityFlags {
  ac: boolean;
  private_bath: boolean;
  wifi: boolean;
  furnished: boolean;
  parking: boolean;
  water_heater: boolean;
  kitchen: boolean;
  laundry: boolean;
  security: boolean;
  utilities: boolean;
  fridge: boolean;
}

function facilityFlags(facilities: string[]): FacilityFlags {
  const text = facilities.join(" | ").toLowerCase();
  return {
    ac: /\bac\b|air conditioner/.test(text),
    private_bath: /km dalam|kamar mandi dalam|kmd|private bath|bathroom dalam/.test(text),
    wifi: /wifi|wi-fi|internet|indihome|biznet/.test(text),
    furnished: /kasur|springbed|spring bed|lemari|meja|furnished|furnish/.test(text),
    parking: /parkir|garasi|carport/.test(text),
    water_heater: /water heater|air panas|pemanas air/.test(text),
    kitchen: /dapur|kitchen/.test(text),
    laundry: /laundry|mesin cuci|cuci/.test(text),
    security: /cctv|security|satpam|penjaga|kartu akses|fingerprint/.test(text),
    utilities: /termasuk listrik|listrik termasuk|free listrik|termasuk air|air termasuk|listrik token/.test(
      text
    ),
    fridge: /kulkas|fridge|lemari es/.test(text),
  };
}

function facilityVector(flags: FacilityFlags): number[] {
  return [
    flags.ac ? 1 : 0,
    flags.private_bath ? 1 : 0,
    flags.wifi ? 1 : 0,
    flags.furnished ? 1 : 0,
    flags.parking ? 1 : 0,
    flags.water_heater ? 1 : 0,
    flags.kitchen ? 1 : 0,
    flags.laundry ? 1 : 0,
    flags.security ? 1 : 0,
    flags.utilities ? 1 : 0,
    flags.fridge ? 1 : 0,
  ];
}

/**
 * Premium fasilitas dalam ruang log-harga.
 * Dipakai untuk menormalkan pembanding sebelum median, sehingga kamar AC
 * tidak dibandingkan mentah-mentah dengan kamar kipas. Angka ini adalah
 * prior konservatif; model hedonic akan mengoreksinya bila data cukup.
 */
const FEATURE_PREMIUMS: Array<[keyof FacilityFlags, number]> = [
  ["ac", 0.18],
  ["private_bath", 0.15],
  ["furnished", 0.08],
  ["wifi", 0.07],
  ["water_heater", 0.06],
  ["parking", 0.04],
  ["security", 0.04],
  ["kitchen", 0.04],
  ["laundry", 0.03],
  ["utilities", 0.03],
  ["fridge", 0.02],
];

function facilityPremium(flags: FacilityFlags): number {
  return FEATURE_PREMIUMS.reduce(
    (sum, [key, premium]) => sum + (flags[key] ? premium : 0),
    0
  );
}

function facilitySimilarity(a: string[], b: string[]): number {
  const left = facilityVector(facilityFlags(a));
  const right = facilityVector(facilityFlags(b));
  const leftCount = left.reduce((sum, value) => sum + value, 0);
  const rightCount = right.reduce((sum, value) => sum + value, 0);
  if (leftCount === 0 && rightCount === 0) return 0.5;
  if (leftCount === 0 || rightCount === 0) return 0.35;

  const intersection = left.reduce(
    (sum, value, index) => sum + (value === 1 && right[index] === 1 ? 1 : 0),
    0
  );
  const union = left.reduce(
    (sum, value, index) => sum + (value === 1 || right[index] === 1 ? 1 : 0),
    0
  );
  return union > 0 ? intersection / union : 0.5;
}

function typeSimilarity(a: PropertyType | null, b: PropertyType | null): number {
  if (a && b) return a === b ? 1 : 0.55;
  return 0.8;
}

function sizeSimilarity(a: number | null | undefined, b: number | null | undefined): number {
  if (!a || !b || a <= 0 || b <= 0) return 0.6;
  return Math.exp(-Math.abs(Math.log(a / b)));
}

function completenessScore(listing: DealCandidate): number {
  let score = 0;
  if (listing.price_monthly != null && listing.price_monthly > 0) score += 0.25;
  if (listing.area_tag && normalizeArea(listing.area_tag).length > 0) score += 0.15;
  if (listing.property_type) score += 0.15;
  if (listing.facilities && listing.facilities.length > 0) score += 0.15;
  if (listing.contact_wa) score += 0.12;
  if (listing.source_url) score += 0.06;
  if (listing.image_urls && listing.image_urls.length > 0) score += 0.05;
  if (listing.title) score += 0.07;
  return clamp(score, 0, 1);
}

function solveLinearSystem(matrix: number[][], vector: number[]): number[] | null {
  const n = vector.length;
  const a = matrix.map((row) => [...row]);
  const b = [...vector];

  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    }
    if (Math.abs(a[pivot][col]) < 1e-9) return null;

    [a[col], a[pivot]] = [a[pivot], a[col]];
    [b[col], b[pivot]] = [b[pivot], b[col]];

    const divisor = a[col][col];
    for (let j = col; j < n; j += 1) a[col][j] /= divisor;
    b[col] /= divisor;

    for (let row = 0; row < n; row += 1) {
      if (row === col) continue;
      const factor = a[row][col];
      if (factor === 0) continue;
      for (let j = col; j < n; j += 1) a[row][j] -= factor * a[col][j];
      b[row] -= factor * b[col];
    }
  }

  return b;
}

interface HedonicRow {
  features: number[];
  target: number;
  weight: number;
}

function hedonicFeatureVector(listing: DealCandidate): number[] {
  const flags = facilityVector(facilityFlags(listing.facilities ?? []));
  const size = listing.room_size_m2;
  return [
    1,
    size && size > 0 ? Math.log(size) : 0,
    size && size > 0 ? 1 : 0,
    ...flags,
  ];
}

/**
 * Ridge regression log(harga) ~ fasilitas + ukuran.
 * Return prediksi log harga (dalam ruang tipe target) atau null jika
 * model tidak stabil.
 */
function fitHedonic(
  rows: HedonicRow[],
  target: DealCandidate,
  baseLog: number
): { prediction: number; r2: number } | null {
  if (rows.length < 8) return null;

  const dim = rows[0].features.length;
  if (dim === 0) return null;

  const matrix: number[][] = Array.from({ length: dim }, () => Array(dim).fill(0));
  const vector: number[] = Array(dim).fill(0);

  for (const row of rows) {
    for (let i = 0; i < dim; i += 1) {
      vector[i] += row.weight * row.features[i] * row.target;
      for (let j = 0; j < dim; j += 1) {
        matrix[i][j] += row.weight * row.features[i] * row.features[j];
      }
    }
  }

  // Regularisasi kuat: data lapangan sedikit dan saling berkorelasi.
  const lambda = Math.max(1.5, rows.length * 0.4);
  for (let i = 1; i < dim; i += 1) matrix[i][i] += lambda;

  const beta = solveLinearSystem(matrix, vector);
  if (!beta) return null;

  const targetFeatures = hedonicFeatureVector(target);
  let prediction = 0;
  for (let i = 0; i < dim; i += 1) prediction += beta[i] * targetFeatures[i];
  if (!Number.isFinite(prediction)) return null;

  // Jangan biarkan model ekstrapolasi liar.
  if (prediction < baseLog - Math.log(1.8) || prediction > baseLog + Math.log(1.8)) {
    return null;
  }

  let weightedMean = 0;
  let totalWeight = 0;
  for (const row of rows) {
    weightedMean += row.weight * row.target;
    totalWeight += row.weight;
  }
  weightedMean /= Math.max(totalWeight, 1e-9);

  let sse = 0;
  let sst = 0;
  for (const row of rows) {
    let fitted = 0;
    for (let i = 0; i < dim; i += 1) fitted += beta[i] * row.features[i];
    sse += row.weight * (row.target - fitted) ** 2;
    sst += row.weight * (row.target - weightedMean) ** 2;
  }

  const r2 = sst > 0 ? 1 - sse / sst : 0;
  if (r2 < 0.08) return null;

  return { prediction, r2 };
}

function assessRisk(
  listing: DealCandidate,
  params: {
    ageDays: number | null;
    priceConfidence: number;
    effectiveSample: number;
    zScore: number | null;
    discountPct: number | null;
    completeness: number;
    confidence: number;
  }
): { score: number; flags: DealRiskFlag[] } {
  const flags: DealRiskFlag[] = [];
  const add = (code: string, label: string, severity: number) => {
    flags.push({ code, label, severity });
  };

  const text = `${listing.title ?? ""} ${listing.raw_text ?? ""} ${listing.ai_summary ?? ""}`;

  if (!listing.contact_wa) add("no_contact", "Nomor kontak tidak dicantumkan", 12);
  if (!listing.source_url) add("no_source", "Link postingan asli tidak tersedia", 6);
  if (!listing.image_urls || listing.image_urls.length === 0) {
    add("no_image", "Tidak ada foto kamar", 5);
  }
  if (!listing.area_tag || normalizeArea(listing.area_tag).length === 0) {
    add("no_area", "Area/lokasi tidak spesifik", 8);
  }
  if (params.completeness < 0.35) add("low_information", "Informasi listing sangat minim", 8);
  if (params.priceConfidence < 0.5) add("unclear_price", "Harga/periodisitas tidak jelas", 10);
  if (params.effectiveSample < 2) add("thin_market", "Data pembanding pasar masih tipis", 8);

  if (params.ageDays != null) {
    if (params.ageDays > 120) add("very_stale", "Listing berumur lebih dari 4 bulan", 20);
    else if (params.ageDays > 60) add("stale", "Listing berumur lebih dari 2 bulan", 12);
    else if (params.ageDays > 30) add("aging", "Listing berumur lebih dari 1 bulan", 6);
  }

  if (params.zScore != null && params.zScore < -3.2) {
    add("extreme_low_price", "Harga jauh di bawah pasar — perlu verifikasi", 18);
  }
  if (params.zScore != null && params.zScore < -4.2) {
    add("implausible_price", "Harga tidak wajar secara statistik", 12);
  }
  if (params.discountPct != null && params.discountPct > 60 && params.effectiveSample >= 4) {
    add("discount_too_high", "Diskon ekstrem — cek kebenaran data", 10);
  }
  if (listing.price_monthly != null && listing.price_monthly < 200_000) {
    add("very_low_price", "Harga di bawah batas wajar kos bulanan", 12);
  }

  // Pola penipuan yang umum di grup kos/menfess.
  if (
    /transfer\s*(?:dulu|dp|sebelum)|dp\s*dulu|bayar\s*dulu\s*sebelum\s*(?:survey|lihat)|tanpa\s*survey|kirim\s*(?:uang|dp)|rekening\s*(?:a\/n|atas\s*nama)/i.test(
      text
    )
  ) {
    add("payment_before_viewing", "Meminta transfer sebelum survey", 30);
  }
  if (/pemilik\s*(?:sedang\s*)?(?:di\s*)?luar\s*(?:kota|negeri)/i.test(text)) {
    add("remote_owner", "Pemilik disebut berada di luar kota/negeri", 15);
  }
  if (/\b(?:buruan|cepat)\b.{0,40}\b(?:dp|transfer)\b/i.test(text)) {
    add("urgency_payment", "Desakan bayar/transfer mendesak", 15);
  }
  if (/\b(?:minta|kirim)\s*(?:kode\s*)?otp\b/i.test(text)) {
    add("otp_request", "Meminta kode OTP", 40);
  }

  const score = clamp(
    flags.reduce((sum, flag) => sum + flag.severity, 0),
    0,
    100
  );

  return {
    score,
    flags: flags.sort((a, b) => b.severity - a.severity),
  };
}

function buildReasons(
  fairPrice: number | null,
  discountPct: number | null,
  confidence: number,
  sampleSize: number,
  ageDays: number | null,
  riskFlags: DealRiskFlag[]
): string[] {
  const reasons: string[] = [];

  if (fairPrice != null) {
    reasons.push(`Nilai pasar area: Rp${fairPrice.toLocaleString("id-ID")}/bulan.`);
  }
  if (discountPct != null && discountPct >= 3) {
    reasons.push(`Harga ${discountPct.toFixed(0)}% di bawah nilai pasar.`);
  } else if (discountPct != null && discountPct <= -5) {
    reasons.push(`Harga ${Math.abs(discountPct).toFixed(0)}% di atas nilai pasar.`);
  }
  if (sampleSize > 0) {
    reasons.push(
      `Dihitung dari ${sampleSize} pembanding sejenis (keyakinan ${(confidence * 100).toFixed(0)}%).`
    );
  }
  if (ageDays != null) {
    if (ageDays < 1) reasons.push("Baru diposting hari ini.");
    else if (ageDays <= 7) reasons.push(`Diposting ${Math.round(ageDays)} hari lalu.`);
  }
  if (riskFlags[0]) {
    reasons.push(`Perlu dicek: ${riskFlags[0].label.toLowerCase()}.`);
  }

  return reasons.slice(0, 5);
}

interface Comparable {
  listing: DealCandidate;
  logPrice: number;
  /** Harga pembanding setelah koreksi tipe + fasilitas + ukuran. */
  adjustedLog: number;
  /** Harga pembanding hanya setelah koreksi tipe; dipakai model hedonic. */
  rawAdjustedLog: number;
  weight: number;
  areaSim: number;
  facilitySim: number;
  typeSim: number;
  sizeSim: number;
}

/**
 * Nilai satu listing terhadap kumpulan listing lain.
 */
export function evaluateDeal(
  target: DealCandidate,
  pool: DealCandidate[],
  options: DealEngineOptions = {}
): DealValuation {
  const now = options.now ?? new Date();
  const policy: DealPolicy = { ...DEFAULT_DEAL_POLICY, ...options };
  const targetPrice =
    target.price_monthly != null && target.price_monthly > 0 ? target.price_monthly : null;
  const priceConfidence = clamp(target.price_confidence ?? 0.7, 0, 1);
  const completeness = completenessScore(target);
  const ageDays = ageInDays(target.posted_at, now);

  const empty: DealValuation = {
    fair_price_monthly: null,
    market_low: null,
    market_high: null,
    discount_pct: null,
    price_z: null,
    sample_size: 0,
    effective_sample: 0,
    confidence: 0,
    risk_score: 0,
    risk_flags: [],
    deal_score: 0,
    grade: "unknown",
    is_undervalued: false,
    reasons: [],
    used_prior: false,
  };

  if (targetPrice == null) {
    const risk = assessRisk(target, {
      ageDays,
      priceConfidence,
      effectiveSample: 0,
      zScore: null,
      discountPct: null,
      completeness,
      confidence: 0,
    });
    return {
      ...empty,
      risk_score: risk.score,
      risk_flags: risk.flags,
      reasons: ["Harga bulanan tidak tersedia — belum bisa dinilai."],
    };
  }

  const targetRatio = target.property_type ? TYPE_MULTIPLIER[target.property_type] : 1;
  const targetFlags = facilityFlags(target.facilities ?? []);
  const targetPremium = facilityPremium(targetFlags);

  const comparables: Comparable[] = [];
  const seenIds = new Set<string>();

  for (const item of pool) {
    if (item === target) continue;
    if (target.id != null && item.id != null && String(item.id) === String(target.id)) continue;

    const price = item.price_monthly;
    if (price == null || price <= 0) continue;

    const age = ageInDays(item.posted_at, now);
    if (age != null && age > policy.maxComparableAgeDays) continue;

    // Hindari pembanding ganda dari sumber yang sama (mirip).
    const dedupeKey = `${price}|${item.area_tag ?? ""}|${item.title ?? ""}`.toLowerCase();
    if (seenIds.has(dedupeKey)) continue;
    seenIds.add(dedupeKey);

    const itemRatio = item.property_type ? TYPE_MULTIPLIER[item.property_type] : 1;
    const logPrice = Math.log(price);
    const rawAdjustedLog = logPrice + Math.log(targetRatio / itemRatio);

    // Koreksi fasilitas & ukuran: bawa harga pembanding ke "spesifikasi target".
    const itemPremium = facilityPremium(facilityFlags(item.facilities ?? []));
    const featureDelta = clamp(targetPremium - itemPremium, -0.35, 0.35);
    const sizeDelta =
      target.room_size_m2 && item.room_size_m2
        ? clamp(
            0.35 * Math.log(target.room_size_m2 / item.room_size_m2),
            -0.25,
            0.25
          )
        : 0;
    const adjustedLog = rawAdjustedLog + featureDelta + sizeDelta;

    const areaSim = areaSimilarity(target.area_tag, item.area_tag);
    const facilitySim = facilitySimilarity(target.facilities ?? [], item.facilities ?? []);
    const typeSim = typeSimilarity(target.property_type, item.property_type);
    const sizeSim = sizeSimilarity(target.room_size_m2, item.room_size_m2);

    const recency = age == null ? 0.72 : Math.pow(0.5, age / 90);
    const rawWeight =
      0.08 + 0.52 * areaSim + 0.18 * facilitySim + 0.14 * typeSim + 0.08 * sizeSim;
    const weight = rawWeight * recency;

    if (weight <= 0) continue;

    comparables.push({
      listing: item,
      logPrice,
      adjustedLog,
      rawAdjustedLog,
      weight,
      areaSim,
      facilitySim,
      typeSim,
      sizeSim,
    });
  }

  const prior =
    options.priorMonthlyPrice != null && options.priorMonthlyPrice > 0
      ? options.priorMonthlyPrice
      : null;

  if (comparables.length === 0 && prior == null) {
    const risk = assessRisk(target, {
      ageDays,
      priceConfidence,
      effectiveSample: 0,
      zScore: null,
      discountPct: null,
      completeness,
      confidence: 0,
    });
    return {
      ...empty,
      risk_score: risk.score,
      risk_flags: risk.flags,
      reasons: ["Belum ada pembanding pasar yang cukup untuk menilai harga."],
    };
  }

  const weights = comparables.map((comp) => comp.weight);
  const adjustedLogs = comparables.map((comp) => comp.adjustedLog);
  const nEff = effectiveSampleSize(weights);

  const cityCenter = weightedMedian(adjustedLogs, weights);
  let baseLog = cityCenter ?? (prior != null ? Math.log(prior) : null);
  let usedPrior = false;

  // Area center hanya dipakai bila ada cukup pembanding yang benar-benar berdekatan.
  const areaComps = comparables.filter((comp) => comp.areaSim >= 0.35);
  if (areaComps.length >= 2) {
    const areaCenter = weightedMedian(
      areaComps.map((comp) => comp.adjustedLog),
      areaComps.map((comp) => comp.weight)
    );
    const areaWeight = areaComps.reduce((sum, comp) => sum + comp.weight, 0);
    if (areaCenter != null && baseLog != null) {
      const alpha = areaWeight / (areaWeight + 3);
      baseLog = areaCenter * alpha + baseLog * (1 - alpha);
    }
  }

  // Prior kota ikut menarik estimasi ke nilai wajar saat data tipis.
  if (prior != null) {
    if (baseLog == null) {
      baseLog = Math.log(prior);
      usedPrior = true;
    } else {
      const priorWeight = nEff < 4 ? 2.2 : 0.8;
      baseLog =
        (baseLog * Math.max(nEff, 0.1) + Math.log(prior) * priorWeight) /
        (Math.max(nEff, 0.1) + priorWeight);
      usedPrior = nEff < 4;
    }
  }

  if (baseLog == null || !Number.isFinite(baseLog)) {
    return empty;
  }

  let fairLog = baseLog;

  const hedonicRows: HedonicRow[] = comparables.map((comp) => ({
    features: hedonicFeatureVector(comp.listing),
    target: comp.rawAdjustedLog,
    weight: comp.weight,
  }));

  if (hedonicRows.length > 0) {
    const hedonic = fitHedonic(hedonicRows, target, baseLog);
    if (hedonic) {
      const blend = clamp((comparables.length - 6) / 18, 0, 0.45);
      fairLog = baseLog * (1 - blend) + hedonic.prediction * blend;
    }
  }

  const fairPrice = roundTo(Math.exp(fairLog));
  if (!Number.isFinite(fairPrice) || fairPrice < MIN_FAIR_PRICE) {
    return empty;
  }

  const zScale = Math.max(
    0.14,
    weightedMad(adjustedLogs, weights, cityCenter ?? baseLog) * 1.4826
  );
  const priceZ = (Math.log(targetPrice) - baseLog) / zScale;

  const rangeScale = zScale * (1 + 2 / Math.sqrt(Math.max(1, nEff)));
  const marketLow = roundTo(fairPrice * Math.exp(-1.28 * rangeScale));
  const marketHigh = roundTo(fairPrice * Math.exp(1.28 * rangeScale));

  const discountPct = ((fairPrice - targetPrice) / fairPrice) * 100;

  const coverage =
    comparables.length > 0
      ? comparables.reduce((sum, comp) => sum + comp.areaSim * comp.weight, 0) /
        Math.max(
          comparables.reduce((sum, comp) => sum + comp.weight, 0),
          1e-9
        )
      : 0;
  const mad = weightedMad(adjustedLogs, weights, cityCenter ?? baseLog);
  const sampleScore = 1 - Math.exp(-nEff / 5);
  const stability = clamp(1 - mad / 0.65, 0.15, 1);
  const freshness = ageDays == null ? 0.7 : Math.exp(-ageDays / 45);

  let confidence =
    0.04 +
    0.38 * sampleScore +
    0.14 * stability +
    0.12 * coverage +
    0.12 * completeness +
    0.14 * priceConfidence +
    0.06 * freshness;

  if (comparables.length < 2) confidence = Math.min(confidence, 0.35);
  if (usedPrior && comparables.length < 2) confidence = Math.min(confidence, 0.4);
  if (comparables.length === 0) confidence = Math.min(confidence, 0.32);
  confidence = clamp(confidence, 0.05, 0.98);

  const risk = assessRisk(target, {
    ageDays,
    priceConfidence,
    effectiveSample: nEff,
    zScore: priceZ,
    discountPct,
    completeness,
    confidence,
  });

  const valueScore = 70 * (1 - Math.exp(-Math.max(discountPct, 0) / 16));
  const zBonus = priceZ < 0 ? clamp((-priceZ - 0.8) * 2.5, 0, 10) : 0;
  const confidenceScore = 14 * confidence;
  const freshnessScore = 8 * freshness;
  const completenessScoreValue = 5 * completeness;
  const riskPenalty = risk.score * 0.55;

  let dealScore =
    valueScore +
    zBonus +
    confidenceScore +
    freshnessScore +
    completenessScoreValue -
    riskPenalty;
  if (discountPct <= 0) dealScore = Math.min(dealScore, 50);
  dealScore = clamp(Math.round(dealScore), 0, 100);

  // Red flag berat (mis. minta transfer sebelum survey) tidak boleh lolos
  // sebagai deal, sekalipun angkanya terlihat sangat murah.
  const hasSevereRisk = risk.flags.some((flag) => flag.severity >= 30);

  let grade: DealGrade;
  if (hasSevereRisk) {
    grade = discountPct >= 5 ? "watch" : "fair";
  } else if (discountPct >= 25 && confidence >= 0.55 && risk.score < 50) {
    grade = "steal";
  } else if (
    discountPct >= policy.minDiscountPct &&
    confidence >= policy.minConfidence &&
    risk.score <= policy.maxRiskScore
  ) {
    grade = "underpriced";
  } else if (discountPct >= 5) {
    grade = "watch";
  } else if (discountPct > -5) {
    grade = "fair";
  } else {
    grade = "overpriced";
  }

  return {
    fair_price_monthly: fairPrice,
    market_low: marketLow,
    market_high: marketHigh,
    discount_pct: Math.round(discountPct * 10) / 10,
    price_z: Math.round(priceZ * 100) / 100,
    sample_size: comparables.length,
    effective_sample: Math.round(nEff * 100) / 100,
    confidence: Math.round(confidence * 1000) / 1000,
    risk_score: risk.score,
    risk_flags: risk.flags,
    deal_score: dealScore,
    grade,
    is_undervalued: grade === "steal" || grade === "underpriced",
    reasons: buildReasons(
      fairPrice,
      discountPct,
      confidence,
      comparables.length,
      ageDays,
      risk.flags
    ),
    used_prior: usedPrior,
  };
}

/**
 * Nilai dan urutkan seluruh feed. Listing yang lolos kurasi (below-market,
 * keyakinan cukup, risiko rendah) selalu berada di atas.
 */
export function rankDeals<T extends DealCandidate>(
  listings: T[],
  options: DealEngineOptions = {}
): RankedDeal<T>[] {
  const ranked = listings.map((listing) => {
    const others = listings.filter((other) => other !== listing);
    return {
      listing,
      valuation: evaluateDeal(listing, others, options),
    };
  });

  return ranked.sort((a, b) => {
    if (a.valuation.is_undervalued !== b.valuation.is_undervalued) {
      return a.valuation.is_undervalued ? -1 : 1;
    }
    if (b.valuation.deal_score !== a.valuation.deal_score) {
      return b.valuation.deal_score - a.valuation.deal_score;
    }
    const discountDiff =
      (b.valuation.discount_pct ?? -999) - (a.valuation.discount_pct ?? -999);
    if (discountDiff !== 0) return discountDiff;
    return (
      new Date(b.listing.posted_at ?? 0).getTime() -
      new Date(a.listing.posted_at ?? 0).getTime()
    );
  });
}

/**
 * Pilih listing yang layak ditampilkan.
 * Kalau belum ada satu pun yang lolos (cold start), kembalikan semua yang
 * punya nilai pasar agar feed tidak kosong, dengan mode "fallback".
 */
export function curateDeals<T extends DealCandidate>(
  ranked: RankedDeal<T>[]
): { mode: "deals" | "fallback"; items: RankedDeal<T>[] } {
  const deals = ranked.filter((item) => item.valuation.is_undervalued);
  if (deals.length > 0) return { mode: "deals", items: deals };

  const withValuation = ranked.filter(
    (item) => item.valuation.fair_price_monthly != null && item.valuation.deal_score > 0
  );
  return {
    mode: "fallback",
    items: withValuation.length > 0 ? withValuation : ranked,
  };
}
