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
import { extractPriceSignal, extractRoomSizeM2 } from "./pricing";
import type { ParsedListing, PropertyType } from "./types";

// ── DeepSeek Client (lazy init) ──
const DEEPSEEK_BASE_URL = "https://api.deepseek.com/v1";
const DEEPSEEK_DEFAULT_MODEL = "deepseek-chat";

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
  "is_negotiable": <true jika harga bisa nego, false jika tidak disebut>
}

Aturan:
- Jika informasi tidak disebutkan, isi null (bukan string kosong).
- Untuk facilities, normalisasi ke bentuk singkat lowercase: "ac", "wifi", "kamar mandi dalam", "kasur", "lemari", "parkir motor", "parkir mobil", "dapur bersama", "laundry", "listrik termasuk", "air termasuk".
- Untuk contact_wa, ambil nomor pertama yang terlihat seperti nomor WA Indonesia.
- price_monthly HARUS ekuivalen bulanan. Contoh: "2,4jt sisa 5 bulan" → price_monthly 480000, price_total 2400000.
- "per tahun"/"12 bulan" dibagi 12; "per semester" dibagi 6. Jangan mencampur deposit dengan harga sewa.
- Jangan mengarang data yang tidak ada di teks.
- ai_summary harus objektif dan informatif, maksimal 2 kalimat.`;

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
export function parseHeuristic(text: string): ParsedListing | null {
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
  const contactSummary = contact_wa ? `Hubungi WA: ${contact_wa}.` : "";
  const ai_summary = `${title}. ${facSummary} ${priceSummary} ${contactSummary}`.trim();

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
 * Parse raw JSON string dari AI dan validasi dengan Zod.
 */
export function parseAndValidate(rawJson: string, silent = false): ParsedListing | null {
  try {
    const parsed = JSON.parse(rawJson);
    const validated = ListingSchema.parse(parsed);

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
    };
  } catch (err) {
    if (!silent && process.env.NODE_ENV !== "test") {
      console.error("[parser] Validation failed:", err);
    }
    return null;
  }
}
