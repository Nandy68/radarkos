/**
 * Normalize nomor WhatsApp Indonesia ke format 62xxx.
 * Menerima: 08xx, +628xx, 628xx, atau 8xx (dari form dengan prefix +62).
 * Mengembalikan: 62xxx... atau null jika invalid.
 */
export function normalizeWA(input: string): string | null {
  const cleaned = input.replace(/[\s\-()+]+/g, "");
  let num: string;

  if (cleaned.startsWith("62")) {
    num = cleaned;
  } else if (cleaned.startsWith("0")) {
    num = "62" + cleaned.slice(1);
  } else if (cleaned.startsWith("8")) {
    num = "62" + cleaned;
  } else {
    return null;
  }

  // Validasi panjang: 62 + 8-13 digit
  if (!/^62[0-9]{8,13}$/.test(num)) {
    return null;
  }

  return num;
}

