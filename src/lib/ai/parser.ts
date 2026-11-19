/**
 * KosRadar — Industrial Listing Extractor & Parser
 *
 * Kombinasi AI Extraction (DeepSeek, OpenAI-compatible API) dengan Deterministic
 * Fallback Parser untuk memastikan setiap data grup kos/menfess berhasil
 * diekstrak 100% tanpa gagal.
 */

import OpenAI from "openai";
import { z } from "zod";
import { normalizeWA } from "@/lib/wa";
import { getAiLimits } from "@/lib/radar/limits";
import { extractPriceSignal, extractRoomSizeM2 } from "@/lib/radar/pricing";
import type { ParsedListing, PropertyType } from "@/lib/radar/types";

// ── DeepSeek Client (lazy init) ──
const DEEPSEEK_BASE_URL = "https://api.deepseek.com/v1";
// API id untuk DeepSeek-V4.1-Flash (rilis bertanggal 1017). Override via DEEPSEEK_MODEL.
const DEEPSEEK_DEFAULT_MODEL = "deepseek-flash";

let _client: { apiKey: string; client: OpenAI } | null = null;

function getDeepSeekClient(apiKey: string): OpenAI {
  // Cache per API key supaya pergantian env (mis. saat test) tidak memakai client basi.
  if (!_client || _client.apiKey !== apiKey) {
    _client = {
      apiKey,
      client: new OpenAI({
        baseURL: process.env.DEEPSEEK_BASE_URL || DEEPSEEK_BASE_URL,
        apiKey,
      }),
    };
  }
  return _client.client;
}

// ── Zod schema untuk validasi output AI ─────────────────────────────────────
export const ListingSchema = z.object({
  title: z.string().min(3).max(200),
  price_monthly: z.number().int().nonnegative().nullable(),
  property_type: z
    .enum(["kos_putra", "kos_putri", "kos_campur", "oper_kontrak"])
    .nullable(),
  area_tag: z.string().max(100).nullable(),
  facilities: z.array(z.string().max(50)).default([]),
  contact_wa: z.string().nullable(),
  is_undervalued: z.boolean().default(false),
  ai_summary: z.string().max(500),
  price_raw: z.string().max(100).nullable().default(null),
  price_period: z
    .enum(["month", "year", "semester", "week", "day", "unknown"])
    .nullable()
    .default(null),
  price_total: z.number().int().nonnegative().nullable().default(null),
  deposit_idr: z.number().int().nonnegative().nullable().default(null),
  room_size_m2: z.number().positive().max(500).nullable().default(null),
  is_negotiable: z.boolean().default(false),
  address_detail: z.string().max(200).nullable().catch(null).default(null),
  maps_url: z.url().nullable().catch(null).default(null),
  landlord_name: z.string().max(100).nullable().catch(null).default(null),
  landlord_type: z
    .enum(["pemilik", "penyewa", "agen"])
    .nullable()
    .catch(null)
    .default(null),
  bathroom_type: z.enum(["dalam", "luar"]).nullable().catch(null).default(null),
  electricity: z
    .enum(["token", "termasuk", "terpisah"])
    .nullable()
    .catch(null)
    .default(null),
  water: z.enum(["termasuk", "pdam", "sumur"]).nullable().catch(null).default(null),
  min_stay_months: z
    .number()
    .int()
    .positive()
    .max(60)
    .nullable()
    .catch(null)
    .default(null),
  available_from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .catch(null)
    .default(null),
  rules: z.record(z.string(), z.boolean()).catch({}).default({}),
  nearby_landmarks: z.array(z.string().max(80)).max(10).catch([]).default([]),
  gender_type: z
    .enum(["Putra", "Putri", "Campur"])
    .nullable()
    .catch(null)
    .default(null),
  listing_type: z
    .enum(["Kos Baru", "Oper Kontrak"])
    .nullable()
    .catch(null)
    .default(null),
  billing_cycle: z
    .enum(["Bulanan", "3 Bulanan", "Tahunan", "Sisa Kontrak"])
    .nullable()
    .catch(null)
    .default(null),
  electricity_included: z.boolean().default(false),
  campus_proximity: z.string().max(100).nullable().catch(null).default(null),
  clean_summary: z.string().max(600).nullable().catch(null).default(null),
  price_yearly: z.number().int().nonnegative().nullable().catch(null).default(null),
  takeover_price: z.number().int().nonnegative().nullable().catch(null).default(null),
  remaining_months: z
    .number()
    .int()
    .positive()
    .max(60)
    .nullable()
    .catch(null)
    .default(null),
});

export type ListingSchemaOutput = z.infer<typeof ListingSchema>;

// ── System prompt ───────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `Kamu adalah AI ekstraktor data listing kos/kontrakan Indonesia.
Dari teks mentah yang diberikan, ekstrak informasi berikut dalam format JSON:

{
  "title": "Judul singkat deskriptif (maks 200 karakter)",
  "price_monthly": <harga sewa bulanan dalam Rupiah (integer) atau null jika tidak disebutkan>,
  "property_type": <salah satu: "kos_putra", "kos_putri", "kos_campur", "oper_kontrak" atau null>,
  "area_tag": <nama area/lokasi spesifik atau null>,
  "facilities": [<daftar fasilitas, contoh: "ac", "wifi", "kamar mandi dalam", "kasur", "lemari">],
  "contact_wa": <nomor WhatsApp dalam format 08xxx atau 628xxx atau null>,
  "is_undervalued": <true jika harga terasa di bawah rata-rata untuk area tersebut, false jika normal atau tidak bisa dinilai>,
  "ai_summary": "Ringkasan 1-2 kalimat padat tentang listing ini",
  "price_raw": <potongan teks harga asli, mis. "2,4jt sisa 5 bulan", atau null>,
  "price_period": <"month" | "year" | "semester" | "week" | "day" | "unknown" | null>,
  "price_total": <harga total kontrak bila nominal yang disebut adalah total, mis. 2400000; selain itu null>,
  "deposit_idr": <nominal deposit/uang muka dalam Rupiah atau null>,
  "room_size_m2": <luas kamar dalam m² bila disebut, mis. 12; selain itu null>,
  "is_negotiable": <true jika harga bisa nego, false jika tidak disebut>,
  "address_detail": <alamat spesifik (Jl./Gg./RT-RW) atau null>,
  "maps_url": <link Google Maps bila ada di teks, selain itu null>,
  "landlord_name": <nama pemilik/penyewa bila disebut atau null>,
  "landlord_type": <"pemilik" | "penyewa" | "agen" | null>,
  "bathroom_type": <"dalam" | "luar" | null>,
  "electricity": <"token" | "termasuk" | "terpisah" | null>,
  "water": <"termasuk" | "pdam" | "sumur" | null>,
  "min_stay_months": <durasi sewa minimum dalam bulan atau null>,
  "available_from": <tanggal bisa dihuni format YYYY-MM-DD atau null>,
  "rules": <objek boolean, hanya key: "has_curfew", "guests_allowed", "couples_allowed">,
  "nearby_landmarks": [<kampus/terminal/landmark terdekat yang disebut>],
  "gender_type": <"Putra" | "Putri" | "Campur" | null>,
  "listing_type": <"Kos Baru" | "Oper Kontrak" | null>,
  "billing_cycle": <"Bulanan" | "3 Bulanan" | "Tahunan" | "Sisa Kontrak" | null>,
  "electricity_included": <true jika listrik termasuk, false jika token/bayar sendiri>,
  "campus_proximity": <estimasi jarak/waktu ke kampus, mis. "± 4 mnt ke Unsoed", atau null>,
  "clean_summary": <ringkasan 2-3 kalimat tentang kondisi kamar, ukuran, lingkungan, alasan takeover, tanpa nomor kontak>,
  "price_yearly": <harga sewa per tahun bila disebut atau null>,
  "takeover_price": <total harga takeover oper kontrak atau null>,
  "remaining_months": <sisa bulan kontrak oper kontrak atau null>
}

Aturan:
- Jika informasi tidak disebutkan, isi null (bukan string kosong).
- Untuk facilities, normalisasi ke bentuk singkat lowercase: "ac", "wifi", "kamar mandi dalam", "kasur", "lemari", "parkir motor", "parkir mobil", "dapur bersama", "laundry", "listrik termasuk", "air termasuk".
- Untuk contact_wa, ambil nomor pertama yang terlihat seperti nomor WA Indonesia.
- price_monthly HARUS ekuivalen bulanan. Contoh: "2,4jt sisa 5 bulan" → price_monthly 480000, price_total 2400000.
- "per tahun"/"12 bulan" dibagi 12; "per semester" dibagi 6. Jangan mencampur deposit dengan harga sewa.
- available_from hanya diisi jika tanggal/keterangan waktu disebut; format YYYY-MM-DD.
- rules hanya berisi key "has_curfew", "guests_allowed", "couples_allowed" dengan nilai boolean.
- maps_url hanya diisi jika URL peta benar-benar ada di teks.
- Normalisasi: "650k"/"650rb" -> 650000; "7,5jt" -> 7500000; "1,2jt" -> 1200000.
- price_monthly HARUS ekuivalen bulanan. "6jt/th" -> price_monthly 500000, price_yearly 6000000, billing_cycle "Tahunan".
- "3 bulan 1,8jt" -> price_monthly 600000, billing_cycle "3 Bulanan".
- Oper kontrak: takeover_price = total takeover, remaining_months = sisa bulan, price_monthly = takeover_price / remaining_months, billing_cycle "Sisa Kontrak".
- DILARANG memakai DP, booking fee, uang muka, atau deposit sebagai price_monthly/takeover_price.
- clean_summary 2-3 kalimat: kondisi kamar, ukuran, lingkungan, alasan takeover. Tanpa nomor kontak.
- campus_proximity contoh: "± 4 mnt ke Unsoed".
- electricity_included true jika listrik termasuk; false jika token/bayar sendiri.
- Jangan mengarang data yang tidak ada di teks.
- ai_summary harus objektif dan informatif, maksimal 2 kalimat.`;

const BATCH_SYSTEM_PROMPT = `${SYSTEM_PROMPT}

Kamu menerima beberapa post sekaligus dalam satu pesan user berformat {"posts":[{"index":0,"text":"..."}]}.
Kembalikan SATU objek JSON: {"items": [{"index": <index dari input>, ...field listing...}]}.
Sertakan setiap index input tepat satu kali. Jangan menggabungkan, menggeser, atau mengubah urutan data antar post.
Jika sebuah post bukan listing kos, tetap kembalikan item untuk index tersebut dengan "title": null.
`;

const GENERIC_TITLE =
  /^(?:Kos|Kos Putra|Kos Putri|Oper Kontrak)\b.*\b(?:Area Kampus Sekitar|Siap Huni)\b/i;

/**
 * Post hanya dikirim ke LLM kalau informasi intinya masih bolong.
 */
export function needsAiEnrichment(parsed: ParsedListing): boolean {
  if (parsed.price_monthly == null) return true;
  if (!parsed.area_tag || parsed.area_tag === "Area Kampus Sekitar") return true;
  if (parsed.property_type == null) return true;
  return GENERIC_TITLE.test(parsed.title);
}

const KNOWN_AREAS = [
  "Sigura-gura", "Suhat", "Soekarno Hatta", "Lowokwaru", "Dinoyo", "Tlogomas", "Klojen", "Sumbersari", "Merjosari",
  "Tembalang", "Banjarsari", "Pleburan", "Sekaran", "Sampangan", "Banyumanik", "Ngaliyan",
  "Grendeng", "Karangwangkal", "Arcawinangun", "Dukuhwaluh", "Berkoh", "Sumampir", "Bancarkembar", "Pabuaran", "Blater",
  "Pogung", "Seturan", "Babarsari", "Gejayan", "Kaliurang", "Jakal", "Condongcatur", "Concat", "Demangan", "Janti",
  "Kentingan", "Jebres", "Gentan", "Pabelan", "Kartasura", "Manahan",
  "Unsoed", "UMP", "Telkom", "UGM", "UNY", "UPN", "UB", "Polinema", "Undip", "UNS", "UMS"
];

function extractAreaTag(text: string): string {
  for (const a of KNOWN_AREAS) {
    const reg = new RegExp(`\\b${a}\\b`, "i");
    if (reg.test(text)) return a;
  }
  const dekat = text.match(/(?:dekat|area|sekitar|jl\.?|jalan)\s+([A-Za-z0-9\s]{3,20}?)(?=[,.\n•\-]|$)/i);
  if (dekat) {
    const candidate = dekat[1].trim();
    if (candidate.length > 2 && !/^(kamar|fasilitas|harga|kost|kos|wa|hub)/i.test(candidate)) {
      return `Dekat ${candidate}`;
    }
  }
  return "Area Kampus Sekitar";
}

function extractAddressDetail(text: string): string | null {
  const match = text.match(/(?:jl\.?|jalan|gg\.?|gang)\s+[^\n,.]+/i);
  if (!match) return null;
  const value = match[0].trim().replace(/\s+/g, " ");
  return value.length >= 5 ? value.slice(0, 160) : null;
}

function extractBathroomType(text: string): "dalam" | "luar" | null {
  if (/km\s*luar|kamar\s*mandi\s*luar/i.test(text)) return "luar";
  if (/km\s*dalam|kamar\s*mandi\s*dalam|kmd/i.test(text)) return "dalam";
  return null;
}

function extractElectricity(text: string): "token" | "termasuk" | "terpisah" | null {
  if (/listrik\s*(termasuk|include)|free\s*listrik|termasuk\s*listrik/i.test(text)) {
    return "termasuk";
  }
  if (/listrik\s*(terpisah|bayar\s*sendiri)|bayar\s*listrik\s*sendiri/i.test(text)) {
    return "terpisah";
  }
  if (/\btoken\b/i.test(text)) return "token";
  return null;
}

function extractWater(text: string): "termasuk" | "pdam" | "sumur" | null {
  if (/air\s*(termasuk|include)|termasuk\s*air/i.test(text)) return "termasuk";
  if (/\bpdam\b/i.test(text)) return "pdam";
  if (/\bsumur\b/i.test(text)) return "sumur";
  return null;
}

function extractMinStayMonths(text: string): number | null {
  const months = text.match(/(?:minimal|min\.?)\s*(\d{1,2})\s*(bulan|bln)\b/i);
  if (months) return Math.min(24, Math.max(1, Number(months[1])));

  const years = text.match(/(?:minimal|min\.?)\s*(\d{1,2})\s*tahun\b/i);
  if (years) return Math.min(24, Math.max(1, Number(years[1]) * 12));

  return null;
}

function extractAvailableFrom(text: string, now: Date): string | null {
  if (
    /bisa\s*(masuk|huni)\s*(sekarang|langsung)|(?:kosong|siap)\s*(?:sekarang|langsung)/i.test(
      text
    )
  ) {
    return now.toISOString().slice(0, 10);
  }

  if (/bulan\s*depan/i.test(text)) {
    const nextMonth = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)
    );
    return nextMonth.toISOString().slice(0, 10);
  }

  return null;
}

function extractRules(text: string): Record<string, boolean> {
  const rules: Record<string, boolean> = {};

  if (/jam\s*malam\s*\d/i.test(text)) rules.has_curfew = true;
  else if (/bebas\s*jam\s*malam|24\s*jam/i.test(text)) rules.has_curfew = false;

  if (/(?:tidak\s*boleh|dilarang)\s*(?:bawa\s*)?tamu|tamu\s*dilarang/i.test(text)) {
    rules.guests_allowed = false;
  } else if (/boleh\s*bawa\s*tamu|tamu\s*diperbolehkan/i.test(text)) {
    rules.guests_allowed = true;
  }

  if (/pasutri|suami\s*istri/i.test(text)) rules.couples_allowed = true;
  else if (/khusus\s*(?:single|sendiri)/i.test(text)) rules.couples_allowed = false;

  return rules;
}

function extractNearbyLandmarks(text: string): string[] {
  const landmarks: string[] = [];
  const pattern =
    /(?:dekat|sekitar|menit\s*dari)\s+([A-Za-z0-9][A-Za-z0-9 .]{1,29}?)(?=[,.\n•\-]|$)/gi;

  for (const match of text.matchAll(pattern)) {
    const value = match[1].trim().replace(/\s+/g, " ");
    if (
      value.length >= 2 &&
      !/^(?:kampus|area|sini|itu)$/i.test(value) &&
      !landmarks.some((item) => item.toLowerCase() === value.toLowerCase())
    ) {
      landmarks.push(value);
    }
    if (landmarks.length >= 3) break;
  }

  return landmarks;
}

function extractPropertyName(text: string): string | null {
  const match = text.match(/(?:kos|kost|wisma|paviliun|griya|pondok)\s+([A-Za-z0-9\s.'"-]{2,25}?)(?=\s*(?:,|•|\n|-|–|dekat|jl|jalan|fasilitas|km|ac|wifi|harga|wa|hub|\d|$))/i);
  if (match) {
    const name = match[1].trim();
    if (!/^(putra|putri|campur|cowok|cewek|murah|eksklusif|baru|bebas|siap|huni)$/i.test(name)) {
      return name;
    }
  }
  return null;
}

/**
 * Heuristic fallback parser yang membaca teks Indonesia jika API AI tidak tersedia.
 */
export function parseHeuristic(
  text: string,
  options?: { now?: Date }
): ParsedListing | null {
  const lower = text.toLowerCase();

  // 1. WhatsApp Number
  let contact_wa: string | null = null;
  const waMatch = text.match(/(?:wa|hub|contact|wa\.me\/|telp|hp)?\s*[:.-]?\s*(08[0-9]{8,12}|628[0-9]{8,12}|\+62\s?8[0-9]{8,12})/i);
  if (waMatch) {
    contact_wa = normalizeWA(waMatch[1]);
  }

  // 2. Price extraction (deterministik, sadar periode & deposit)
  const priceSignal = extractPriceSignal(text);
  const price_monthly = priceSignal.monthly;
  const totalCandidate = priceSignal.candidates
    .filter((candidate) => candidate.isTotal && !candidate.isDeposit)
    .sort((a, b) => b.score - a.score)[0];
  const room_size_m2 = extractRoomSizeM2(text);

  // 3. Property Type
  let property_type: PropertyType = "kos_campur";
  if (/oper\s*kontrak|take\s*over|over\s*kontrak|sisa\s*kontrak/i.test(lower)) {
    property_type = "oper_kontrak";
  } else if (/putri|cewek|wanita|muslimah/i.test(lower)) {
    property_type = "kos_putri";
  } else if (/putra|cowok|pria/i.test(lower)) {
    property_type = "kos_putra";
  }

  // 4. Facilities
  const facilities: string[] = [];
  if (/km\s*dalam|kamar\s*mandi\s*dalam|kmd/i.test(lower)) facilities.push("KM Dalam");
  if (/\bac\b|air\s*conditioner/i.test(lower)) facilities.push("AC");
  if (/wifi|wi-fi|internet/i.test(lower)) facilities.push("WiFi");
  if (/kasur|springbed|spring\s*bed/i.test(lower)) facilities.push("Kasur");
  if (/lemari/i.test(lower)) facilities.push("Lemari");
  if (/meja\s*belajar|meja\s*kursi/i.test(lower)) facilities.push("Meja Belajar");
  if (/parkir\s*motor/i.test(lower)) facilities.push("Parkir Motor");
  if (/parkir\s*mobil|garasi/i.test(lower)) facilities.push("Parkir Mobil");
  if (/dapur/i.test(lower)) facilities.push("Dapur Bersama");
  if (/water\s*heater|air\s*panas/i.test(lower)) facilities.push("Water Heater");
  if (/bebas\s*jam\s*malam|24\s*jam/i.test(lower)) facilities.push("Bebas Jam Malam");
  if (/token|listrik\s*token/i.test(lower)) facilities.push("Listrik Token");
  if (/free\s*listrik|termasuk\s*listrik|include\s*listrik/i.test(lower)) facilities.push("Listrik Termasuk");
  if (/cctv/i.test(lower)) facilities.push("CCTV");

  // 5. Area & Title yang bersih dan informatif
  const area_tag = extractAreaTag(text);
  const propName = extractPropertyName(text);
  const isOper = property_type === "oper_kontrak";
  const typeLabel = isOper
    ? "Oper Kontrak"
    : property_type === "kos_putri"
    ? "Kos Putri"
    : property_type === "kos_putra"
    ? "Kos Putra"
    : "Kos";

  const topFac = facilities.slice(0, 2).join(" & ");
  const facSuffix = topFac ? ` (${topFac})` : "";

  let title: string;
  if (isOper) {
    const sisaBulan = text.match(/sisa\s*(\d{1,2})\s*bulan/i);
    const durationLabel = sisaBulan ? ` Sisa ${sisaBulan[1]} Bln` : "";
    title = `Oper Kontrak ${area_tag}${durationLabel}${facSuffix}`;
  } else if (propName) {
    title = `${typeLabel} ${propName} — ${area_tag}${facSuffix}`;
  } else {
    title = `${typeLabel} di ${area_tag}${facSuffix}`;
  }

  // 6. Ringkasan Deskripsi Cerdas
  const facSummary = facilities.length > 0 ? `Fasilitas: ${facilities.join(", ")}.` : "";
  const priceSummary = price_monthly
    ? `Sewa Rp${price_monthly.toLocaleString("id-ID")}/bln.`
    : "Harga dapat ditanyakan langsung ke pemilik.";
  // Kontak hanya boleh masuk contact_wa; teks ringkasan tampil ke user gratis.
  const ai_summary = `${title}. ${facSummary} ${priceSummary}`.trim();

  return {
    title,
    price_monthly,
    property_type,
    area_tag,
    facilities,
    contact_wa,
    // Keputusan undervalued diserahkan ke mesin valuasi pasar, bukan ambang harga.
    is_undervalued: false,
    ai_summary: ai_summary.slice(0, 300),
    price_raw: priceSignal.raw,
    price_period: priceSignal.period,
    price_total: totalCandidate?.amount ?? null,
    deposit_idr: priceSignal.deposit,
    room_size_m2,
    is_negotiable: priceSignal.negotiable,
    address_detail: extractAddressDetail(text),
    maps_url: null,
    landlord_name: null,
    landlord_type: null,
    bathroom_type: extractBathroomType(text),
    electricity: extractElectricity(text),
    water: extractWater(text),
    min_stay_months: extractMinStayMonths(text),
    available_from: extractAvailableFrom(text, options?.now ?? new Date()),
    rules: extractRules(text),
    nearby_landmarks: extractNearbyLandmarks(text),
  };
}

/**
 * Parse teks listing menggunakan AI dengan fallback ke Heuristic parser.
 */
export async function parseListing(
  cleanedText: string,
  options?: {
    model?: string;
    client?: OpenAI;
  }
): Promise<ParsedListing | null> {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  const client = options?.client ?? (apiKey ? getDeepSeekClient(apiKey) : null);
  const model = options?.model ?? process.env.DEEPSEEK_MODEL ?? DEEPSEEK_DEFAULT_MODEL;

  // Tanpa API key (dan tanpa client injeksi), langsung gunakan heuristic.
  if (!client) {
    return parseHeuristic(cleanedText);
  }

  try {
    const completion = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: cleanedText },
      ],
      response_format: { type: "json_object" },
      temperature: 0.1,
      max_tokens: 1024,
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) {
      return parseHeuristic(cleanedText);
    }

    const validated = parseAndValidate(raw);
    return validated || parseHeuristic(cleanedText);
  } catch (err) {
    console.warn("[parser] AI call failed, using heuristic fallback:", err);
    return parseHeuristic(cleanedText);
  }
}

/**
 * Validasi satu objek hasil AI dengan Zod.
 */
export function parseAndValidateObject(
  value: unknown,
  silent = false
): ParsedListing | null {
  try {
    const validated = ListingSchema.parse(value);

    let normalizedContact: string | null = null;
    if (validated.contact_wa) {
      normalizedContact = normalizeWA(validated.contact_wa);
    }

    return {
      title: validated.title,
      price_monthly: validated.price_monthly,
      property_type: validated.property_type as PropertyType | null,
      area_tag: validated.area_tag,
      facilities: validated.facilities,
      contact_wa: normalizedContact,
      is_undervalued: validated.is_undervalued,
      ai_summary: validated.ai_summary,
      price_raw: validated.price_raw,
      price_period: validated.price_period,
      price_total: validated.price_total,
      deposit_idr: validated.deposit_idr,
      room_size_m2: validated.room_size_m2,
      is_negotiable: validated.is_negotiable,
      address_detail: validated.address_detail,
      maps_url: validated.maps_url,
      landlord_name: validated.landlord_name,
      landlord_type: validated.landlord_type,
      bathroom_type: validated.bathroom_type,
      electricity: validated.electricity,
      water: validated.water,
      min_stay_months: validated.min_stay_months,
      available_from: validated.available_from,
      rules: validated.rules,
      nearby_landmarks: validated.nearby_landmarks,
      gender_type: validated.gender_type,
      listing_type: validated.listing_type,
      billing_cycle: validated.billing_cycle,
      electricity_included: validated.electricity_included,
      campus_proximity: validated.campus_proximity,
      clean_summary: validated.clean_summary,
      price_yearly: validated.price_yearly,
      takeover_price: validated.takeover_price,
      remaining_months: validated.remaining_months,
    };
  } catch (err) {
    if (!silent && process.env.NODE_ENV !== "test") {
      console.error("[parser] Validation failed:", err);
    }
    return null;
  }
}

/**
 * Parse raw JSON string dari AI dan validasi dengan Zod.
 */
export function parseAndValidate(rawJson: string, silent = false): ParsedListing | null {
  try {
    return parseAndValidateObject(JSON.parse(rawJson), silent);
  } catch (err) {
    if (!silent && process.env.NODE_ENV !== "test") {
      console.error("[parser] Validation failed:", err);
    }
    return null;
  }
}

export interface BatchParseOutput {
  items: (ParsedListing | null)[];
  usage: { prompt_tokens: number; completion_tokens: number } | null;
}

function readUsage(completion: {
  usage?: { prompt_tokens?: number | null; completion_tokens?: number | null } | null;
}): BatchParseOutput["usage"] {
  if (!completion.usage) return null;
  return {
    prompt_tokens: completion.usage.prompt_tokens ?? 0,
    completion_tokens: completion.usage.completion_tokens ?? 0,
  };
}

/**
 * Parse beberapa post dalam SATU panggilan LLM.
 * Item dicocokkan lewat field `index`, bukan urutan array respons.
 */
export async function parseListingBatch(
  texts: string[],
  options?: { model?: string; client?: OpenAI; maxCharsPerPost?: number }
): Promise<BatchParseOutput> {
  const empty: BatchParseOutput = {
    items: texts.map(() => null),
    usage: null,
  };

  if (texts.length === 0) return { items: [], usage: null };

  const apiKey = process.env.DEEPSEEK_API_KEY;
  const client = options?.client ?? (apiKey ? getDeepSeekClient(apiKey) : null);
  if (!client) return empty;

  const model = options?.model ?? process.env.DEEPSEEK_MODEL ?? DEEPSEEK_DEFAULT_MODEL;
  const maxChars = options?.maxCharsPerPost ?? getAiLimits().maxCharsPerPost;
  const posts = texts.map((text, index) => ({
    index,
    text: text.slice(0, maxChars),
  }));

  try {
    const completion = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: BATCH_SYSTEM_PROMPT },
        { role: "user", content: JSON.stringify({ posts }) },
      ],
      response_format: { type: "json_object" },
      temperature: 0.1,
      max_tokens: 2048,
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) return empty;

    const payload = JSON.parse(raw) as { items?: unknown };
    const rawItems = Array.isArray(payload.items) ? payload.items : [];
    const items: (ParsedListing | null)[] = texts.map(() => null);

    rawItems.forEach((rawItem, position) => {
      const rawIndex =
        typeof rawItem === "object" &&
        rawItem !== null &&
        Number.isInteger((rawItem as { index?: unknown }).index)
          ? Number((rawItem as { index: number }).index)
          : position;

      const target =
        rawIndex >= 0 && rawIndex < texts.length ? rawIndex : position;

      if (target >= 0 && target < texts.length && items[target] === null) {
        items[target] = parseAndValidateObject(rawItem, true);
      }
    });

    return { items, usage: readUsage(completion) };
  } catch (err) {
    console.warn("[parser] Batch AI call failed, using heuristic fallback:", err);
    return empty;
  }
}
