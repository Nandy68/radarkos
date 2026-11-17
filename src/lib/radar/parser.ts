/**
 * KosRadar — AI Listing Extractor
 *
 * Menggunakan OpenAI-compatible SDK ke api.vikey.ai model vikey/agent-mocin
 * dengan Structured JSON output untuk mengekstrak data listing kos.
 */

import OpenAI from "openai";
import { z } from "zod";
import { normalizeWA } from "@/lib/wa";
import type { ParsedListing, PropertyType } from "./types";

// ── Vikey AI Client (lazy init to avoid crash when VIKEY_API_KEY is unset) ──
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
  "ai_summary": "Ringkasan 1-2 kalimat padat tentang listing ini"
}

Aturan:
- Jika informasi tidak disebutkan, isi null (bukan string kosong).
- Untuk facilities, normalisasi ke bentuk singkat lowercase: "ac", "wifi", "kamar mandi dalam", "kasur", "lemari", "parkir motor", "parkir mobil", "dapur bersama", "laundry", "listrik termasuk", "air termasuk".
- Untuk contact_wa, ambil nomor pertama yang terlihat seperti nomor WA Indonesia.
- Jangan mengarang data yang tidak ada di teks.
- ai_summary harus objektif dan informatif, maksimal 2 kalimat.`;

/**
 * Parse teks listing menggunakan Vikey AI.
 *
 * @param cleanedText - Teks yang sudah dibersihkan oleh prefilter.
 * @param options.model - Override model (default: vikey/agent-mocin).
 * @param options.client - Override OpenAI client (untuk testing).
 * @returns ParsedListing yang sudah divalidasi, atau null jika gagal.
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
      console.error("[parser] AI returned empty content");
      return null;
    }

    return parseAndValidate(raw);
  } catch (err) {
    console.error("[parser] AI call failed:", err);
    return null;
  }
}

/**
 * Parse raw JSON string dari AI dan validasi dengan Zod.
 * Exported untuk unit testing.
 */
export function parseAndValidate(rawJson: string, silent = false): ParsedListing | null {
  try {
    const parsed = JSON.parse(rawJson);
    const validated = ListingSchema.parse(parsed);

    // Normalisasi contact_wa
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
    };
  } catch (err) {
    if (!silent && process.env.NODE_ENV !== "test") {
      console.error("[parser] Validation failed:", err);
    }
    return null;
  }
}
