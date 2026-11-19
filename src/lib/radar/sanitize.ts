/**
 * Sensor kontak terpusat untuk semua teks yang terlihat oleh user gratis.
 * Urutan penting: link dulu, nomor telepon belakangan.
 */

export const CONTACT_LOCKED = "[kontak terkunci]";

const WA_LINK = /(?:https?:\/\/)?(?:www\.)?wa\.me\/[^\s)]+/gi;
const TG_PHONE_LINK = /(?:https?:\/\/)?t\.me\/\+?\d[\d\s-]*/gi;
const PHONE = /(?:\+?62|0)[\s.-]?8(?:[\s.-]?\d){7,12}\b/g;

export function sanitizeFreeText(
  value: string | null | undefined
): string | null {
  if (value == null) return null;

  return value
    .replace(WA_LINK, CONTACT_LOCKED)
    .replace(TG_PHONE_LINK, CONTACT_LOCKED)
    .replace(PHONE, CONTACT_LOCKED)
    .trim();
}
