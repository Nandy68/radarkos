/**
 * KosRadar — Pre-Filter & Deduplikasi
 *
 * Filter teks mentah sebelum memanggil AI:
 * 1. Tolak teks terlalu pendek (< 20 karakter).
 * 2. Tolak teks tanpa kata kunci hunian.
 * 3. Tolak teks spam/promosi.
 * 4. Bersihkan teks (normalisasi whitespace, hapus emoji berlebih).
 * 5. Ekstrak nomor kontak sebagai hint.
 * 6. Buat source_hash untuk dedup.
 */

import { sha256 } from "@/lib/hash";
import type { PrefilterResult } from "./types";

// ── Kata kunci hunian yang WAJIB ada (minimal 1) ────────────────────────────
const HOUSING_KEYWORDS = [
  /\bkos(?:t(?:an)?|an)?\b/i,  // kos, kost, kostan, kosan
  /\boper\s*kontrak\b/i,
  /\bkamar\s*kosong\b/i,
  /\bkontrakan\b/i,
  /\brumah\s*kos\b/i,
  /\bsewa\s*kamar\b/i,
  /\bkamar\s*kos\b/i,
  /\bindekos\b/i,
  /\bkos[- ]?kos(?:an)?\b/i,
];

// ── Pola spam / promosi ─────────────────────────────────────────────────────
const SPAM_PATTERNS = [
  /\b(?:slot\s*gacor|judi\s*online|togel|poker\s*online)\b/i,
  /\b(?:pinjaman?\s*online|pinjol|dana\s*cair)\b/i,
  /\b(?:klik\s*(?:di\s*)?sini|daftar\s*sekarang|join\s*gratis)\b/i,
  /\b(?:binary\s*option|crypto\s*trading|forex\s*signal)\b/i,
  /\b(?:obat\s*kuat|viagra|pembesar)\b/i,
  /\b(?:mlm|money\s*game|investasi\s*bodong)\b/i,
  /(?:https?:\/\/\S+[\s,;]*){5,}/i, // ≥5 URLs → likely spam
  /(.)\1{10,}/, // karakter berulang ≥10x
];

// ── Pola nomor telepon / WA ─────────────────────────────────────────────────
const PHONE_PATTERN = /(?:\+?62|0)[\s\-]?8[\d\s\-]{7,14}/g;

// ── Batas minimum panjang teks ──────────────────────────────────────────────
const MIN_TEXT_LENGTH = 20;

/**
 * Bersihkan teks mentah:
 * - Normalisasi whitespace (collapse multiple spaces/newlines).
 * - Hapus zero-width characters.
 * - Trim.
 */
export function cleanText(raw: string): string {
  return raw
    .replace(/[\u200B-\u200D\uFEFF]/g, "") // zero-width chars
    .replace(/\r\n/g, "\n") // normalize line endings
    .replace(/[ \t]+/g, " ") // collapse horizontal whitespace
    .replace(/\n{3,}/g, "\n\n") // max 2 newlines
    .trim();
}

/**
 * Cek apakah teks mengandung setidaknya 1 kata kunci hunian.
 */
export function hasHousingKeyword(text: string): boolean {
  return HOUSING_KEYWORDS.some((pattern) => pattern.test(text));
}

/**
 * Cek apakah teks terdeteksi sebagai spam/promosi.
 */
export function isSpam(text: string): boolean {
  return SPAM_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Ekstrak nomor telepon/WA pertama dari teks.
 * Return raw match (belum dinormalisasi).
 */
export function extractContactHint(text: string): string | null {
  const match = text.match(PHONE_PATTERN);
  return match ? match[0].replace(/[\s\-]/g, "") : null;
}

/**
 * Buat source_hash unik: SHA-256(cleaned_text + contact_hint).
 * Digunakan untuk deduplikasi sebelum AI parse & sebelum DB insert.
 */
export async function createSourceHash(
  cleanedText: string,
  contactHint: string | null
): Promise<string> {
  const input = `${cleanedText.toLowerCase()}|${contactHint ?? ""}`;
  return sha256(input);
}

/**
 * Pre-filter utama. Return PrefilterResult.
 *
 * TIDAK melakukan pengecekan duplikat ke Supabase — itu dilakukan oleh caller
 * (ingest endpoint) agar fungsi ini tetap pure & testable.
 */
export async function prefilter(rawText: string): Promise<PrefilterResult> {
  const cleaned = cleanText(rawText);

  // 1. Terlalu pendek
  if (cleaned.length < MIN_TEXT_LENGTH) {
    return { passed: false, reason: "too_short" };
  }

  // 2. Tidak ada kata kunci hunian
  if (!hasHousingKeyword(cleaned)) {
    return { passed: false, reason: "no_keyword" };
  }

  // 3. Terdeteksi spam
  if (isSpam(cleaned)) {
    return { passed: false, reason: "spam" };
  }

  // 4. Passed → buat hash & contact hint
  const contactHint = extractContactHint(cleaned);
  const sourceHash = await createSourceHash(cleaned, contactHint);

  return {
    passed: true,
    cleaned_text: cleaned,
    source_hash: sourceHash,
    contact_hint: contactHint ?? undefined,
  };
}
