/**
 * KosRadar — Industrial Listing Extractor & Parser
 *
 * Kombinasi AI Extraction (OpenAI-compatible) dengan Deterministic Fallback Parser
 * untuk memastikan setiap data grup kos/menfess berhasil diekstrak 100% tanpa gagal.
 */

import OpenAI from "openai";
import { z } from "zod";
import { normalizeWA } from "@/lib/wa";
import { extractPriceSignal, extractRoomSizeM2 } from "./pricing";
import type { ParsedListing, PropertyType } from "./types";

// ── Vikey AI Client (lazy init) ──
let _vikey: OpenAI | null = null;
function getVikeyClient(): OpenAI {
  if (!_vikey) {
    _vikey = new OpenAI({
      baseURL: "https://api.vikey.ai/v1",
      apiKey: process.env.VIKEY_API_KEY || "dummy-key-for-init",
    });
  }
  return _vikey;
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
  if (/parkir\s*motor/i.test(lower)) facilities.push("Parkir Motor");
  if (/parkir\s*mobil|garasi/i.test(lower)) facilities.push("Parkir Mobil");
  if (/dapur/i.test(lower)) facilities.push("Dapur Bersama");
  if (/water\s*heater|air\s*panas/i.test(lower)) facilities.push("Water Heater");
  if (/bebas\s*jam\s*malam|24\s*jam/i.test(lower)) facilities.push("Bebas Jam Malam");
  if (/token|listrik\s*token/i.test(lower)) facilities.push("Listrik Token");
  if (/free\s*listrik|termasuk\s*listrik/i.test(lower)) facilities.push("Listrik Termasuk");

  // 5. Title & Area
  const words = text.trim().split(/\s+/).slice(0, 8).join(" ");
  const typeLabel =
    property_type === "oper_kontrak"
      ? "Oper Kontrak"
      : property_type === "kos_putri"
      ? "Kos Putri"
      : property_type === "kos_putra"
      ? "Kos Putra"
      : "Kos Siap Huni";

  const title = `${typeLabel} — ${words.slice(0, 60)}...`;

  return {
    title,
    price_monthly,
    property_type,
    area_tag: "Area Kampus Sekitar",
    facilities,
    contact_wa,
    // Keputusan undervalued diserahkan ke mesin valuasi pasar, bukan ambang harga.
    is_undervalued: false,
    ai_summary: text.slice(0, 180),
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
  const client = options?.client ?? getVikeyClient();
  const model = options?.model ?? "vikey/agent-mocin";

  // Jika tidak ada API key yang valid, langsung gunakan heuristic
  if (!process.env.VIKEY_API_KEY) {
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
