/**
 * KosRadar — AI Negotiator Draft
 *
 * Generator teks pesan WhatsApp sopan dan siap klik
 * berdasarkan data listing kos.
 */

import type { ParsedListing } from "./types";

interface NegotiatorInput {
  listing: ParsedListing;
  /** Nama pengguna (opsional, untuk personalisasi). */
  userName?: string;
  /** Mode pesan. */
  mode?: "inquiry" | "negotiate" | "booking";
}

/**
 * Generate teks pesan WhatsApp yang sopan dan siap kirim.
 * Tidak membutuhkan AI — template-based untuk kecepatan & gratis.
 */
export function generateWAMessage(input: NegotiatorInput): string {
  const { listing, userName, mode = "inquiry" } = input;

  const greeting = getGreeting();
  const name = userName ? ` ${userName}` : "";
  const priceStr = listing.price_monthly
    ? formatRupiah(listing.price_monthly)
    : "belum tercantum";

  const typeLabel = getPropertyTypeLabel(listing.property_type);
  const areaStr = listing.area_tag ? ` di ${listing.area_tag}` : "";
  const facilitiesStr =
    listing.facilities.length > 0
      ? listing.facilities.slice(0, 5).join(", ")
      : "";

  switch (mode) {
    case "inquiry":
      return buildInquiry({
        greeting,
        name,
        title: listing.title,
        typeLabel,
        areaStr,
        priceStr,
        facilitiesStr,
      });

    case "negotiate":
      return buildNegotiate({
        greeting,
        name,
        title: listing.title,
        typeLabel,
        areaStr,
        priceStr,
      });

    case "booking":
      return buildBooking({
        greeting,
        name,
        title: listing.title,
        typeLabel,
        areaStr,
        priceStr,
      });

    default:
      return buildInquiry({
        greeting,
        name,
        title: listing.title,
        typeLabel,
        areaStr,
        priceStr,
        facilitiesStr,
      });
  }
}

/**
 * Generate WA click-to-chat URL.
 */
export function generateWALink(
  phoneNumber: string,
  message: string
): string {
  const encoded = encodeURIComponent(message);
  return `https://wa.me/${phoneNumber}?text=${encoded}`;
}

// ── Template builders ───────────────────────────────────────────────────────

function buildInquiry(p: {
  greeting: string;
  name: string;
  title: string;
  typeLabel: string;
  areaStr: string;
  priceStr: string;
  facilitiesStr: string;
}): string {
  let msg = `${p.greeting}! 🙏\n\n`;
  msg += `Perkenalkan, saya${p.name}. Saya tertarik dengan ${p.typeLabel} "${p.title}"${p.areaStr}.\n\n`;
  msg += `Saya lihat harganya ${p.priceStr}/bulan.`;
  if (p.facilitiesStr) {
    msg += ` Fasilitas yang tertera: ${p.facilitiesStr}.`;
  }
  msg += `\n\nBoleh saya tanya beberapa hal?\n`;
  msg += `1. Apakah kamar masih tersedia?\n`;
  msg += `2. Boleh survey/lihat dulu?\n`;
  msg += `3. Apakah ada syarat khusus?\n\n`;
  msg += `Terima kasih banyak! 😊`;
  return msg;
}

function buildNegotiate(p: {
  greeting: string;
  name: string;
  title: string;
  typeLabel: string;
  areaStr: string;
  priceStr: string;
}): string {
  let msg = `${p.greeting}! 🙏\n\n`;
  msg += `Saya${p.name}, tertarik dengan ${p.typeLabel} "${p.title}"${p.areaStr}.\n\n`;
  msg += `Saya lihat harganya ${p.priceStr}/bulan. `;
  msg += `Apakah bisa dapat harga spesial kalau saya langsung bayar untuk beberapa bulan ke depan?\n\n`;
  msg += `Saya serius mau ambil dan bisa survey dalam waktu dekat.\n\n`;
  msg += `Terima kasih sebelumnya! 🙏`;
  return msg;
}

function buildBooking(p: {
  greeting: string;
  name: string;
  title: string;
  typeLabel: string;
  areaStr: string;
  priceStr: string;
}): string {
  let msg = `${p.greeting}! 🙏\n\n`;
  msg += `Saya${p.name}, mau booking ${p.typeLabel} "${p.title}"${p.areaStr}.\n\n`;
  msg += `Harganya ${p.priceStr}/bulan ya. `;
  msg += `Saya mau langsung ambil. Bagaimana prosedur pembayaran DP/uang muka?\n\n`;
  msg += `Kapan bisa mulai masuk?\n\n`;
  msg += `Terima kasih! 🙏`;
  return msg;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 11) return "Selamat pagi";
  if (hour < 15) return "Selamat siang";
  if (hour < 18) return "Selamat sore";
  return "Selamat malam";
}

function formatRupiah(amount: number): string {
  return `Rp${amount.toLocaleString("id-ID")}`;
}

function getPropertyTypeLabel(
  type: string | null | undefined
): string {
  switch (type) {
    case "kos_putra":
      return "kos putra";
    case "kos_putri":
      return "kos putri";
    case "kos_campur":
      return "kos campur";
    case "oper_kontrak":
      return "oper kontrak";
    default:
      return "kamar kos";
  }
}
