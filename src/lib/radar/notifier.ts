/**
 * KosRadar — Radar Alert Dispatcher
 *
 * Mengirim notifikasi WhatsApp otomatis ke pelanggan aktif saat ada
 * listing kos baru yang cocok dengan kriteria alert mereka.
 */

import { formatRupiah } from "@/lib/format";
import { generateWALink, generateWAMessage } from "./negotiator";
import type { ListingInsert, PropertyType } from "./types";

export interface AlertCriteria {
  max_price?: number;
  property_type?: PropertyType;
  area?: string;
}

export interface ActiveSubscriber {
  id: string;
  user_wa: string;
  alert_criteria: AlertCriteria;
}

/**
 * Cek apakah listing cocok dengan kriteria filter pelanggan.
 */
export function isMatchingCriteria(
  criteria: AlertCriteria | null | undefined,
  listing: ListingInsert
): boolean {
  if (!criteria) return true;

  // 1. Filter harga maksimum
  if (
    criteria.max_price != null &&
    listing.price_monthly != null &&
    listing.price_monthly > criteria.max_price
  ) {
    return false;
  }

  // 2. Filter tipe properti
  if (
    criteria.property_type &&
    listing.property_type &&
    listing.property_type !== criteria.property_type
  ) {
    return false;
  }

  // 3. Filter area
  if (criteria.area) {
    const areaQuery = criteria.area.trim().toLowerCase();
    const areaTag = (listing.area_tag || "").toLowerCase();
    const title = (listing.title || "").toLowerCase();
    if (!areaTag.includes(areaQuery) && !title.includes(areaQuery)) {
      return false;
    }
  }

  return true;
}

/**
 * Susun pesan notifikasi WhatsApp yang rapi, padat, dan langsung siap klik.
 */
export function formatAlertMessage(
  listing: ListingInsert,
  cityName = "Kotamu"
): string {
  const price = formatRupiah(listing.price_monthly);
  const area = listing.area_tag || cityName;
  const facilities =
    listing.facilities && listing.facilities.length > 0
      ? listing.facilities.slice(0, 5).join(", ")
      : "-";

  let waDirectLink = "";
  if (listing.contact_wa) {
    const draft = generateWAMessage({
      listing: {
        title: listing.title || "Kamar Kos",
        price_monthly: listing.price_monthly,
        property_type: listing.property_type,
        area_tag: listing.area_tag,
        facilities: listing.facilities || [],
        contact_wa: listing.contact_wa,
        is_undervalued: listing.is_undervalued,
        ai_summary: listing.ai_summary || "",
      },
      mode: "inquiry",
    });
    waDirectLink = generateWALink(listing.contact_wa, draft);
  }

  const typeLabel = listing.property_type
    ? listing.property_type.replace("_", " ").toUpperCase()
    : "KOS";

  let msg = `⚡ *[RADAR ALERT KOSBARU]* ⚡\n`;
  msg += `Ada info kos baru masuk di *${area}*!\n\n`;
  msg += `🏠 *${listing.title || "Kamar Kos Baru"}*\n`;
  msg += `💰 *${price} / bulan*\n`;
  msg += `🏷️ Tipe: *${typeLabel}*`;
  if (listing.is_undervalued) {
    msg += ` 🔥 *[DI BAWAH PASAR]*`;
  }
  msg += `\n`;
  if (
    typeof listing.discount_pct === "number" &&
    listing.discount_pct > 0
  ) {
    msg += `📉 *${Math.round(listing.discount_pct)}% di bawah nilai pasar*`;
    if (typeof listing.market_value === "number" && listing.market_value > 0) {
      msg += ` (pasar ${formatRupiah(listing.market_value)})`;
    }
    msg += `\n`;
  }
  if (typeof listing.deal_confidence === "number") {
    msg += `🎯 Keyakinan model: ${Math.round(listing.deal_confidence * 100)}%`;
    if (typeof listing.sample_size === "number" && listing.sample_size > 0) {
      msg += ` · ${listing.sample_size} pembanding`;
    }
    msg += `\n`;
  }
  msg += `📍 Area: ${area}\n`;
  msg += `✨ Fasilitas: ${facilities}\n\n`;

  if (listing.ai_summary) {
    msg += `📝 *Ringkasan:* \n_${listing.ai_summary}_\n\n`;
  }

  if (waDirectLink) {
    msg += `📲 *Chat Pemilik Kos Langsung (WA):*\n${waDirectLink}\n\n`;
  } else if (listing.contact_wa) {
    msg += `📞 *Kontak:* ${listing.contact_wa}\n\n`;
  }

  if (listing.source_url) {
    msg += `🔗 *Postingan Asli:* \n${listing.source_url}\n\n`;
  }

  msg += `⏱️ _Segera hubungi sebelum diserobot pemburu kos lain._\n`;
  msg += `Radar Kos Aktif • KosRadar`;

  return msg;
}

export interface SendWAResult {
  success: boolean;
  simulated?: boolean;
  wa_link?: string;
  error?: string;
}

/**
 * Adapter pengiriman ke WhatsApp Gateway (Fonnte, Waha, Baileys, generic).
 */
export async function sendWhatsAppMessage(
  targetWA: string,
  message: string,
  fetchFn = fetch
): Promise<SendWAResult> {
  const gatewayUrl = process.env.WA_GATEWAY_URL;
  const token = process.env.WA_GATEWAY_TOKEN || "";

  // Normalisasi nomor target (tanpa tanda +)
  const phone = targetWA.replace(/^\+/, "");
  const directWALink = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;

  if (!gatewayUrl || gatewayUrl.trim() === "") {
    console.warn(`[radar-alert] WA_GATEWAY_URL tidak diatur. Alert ke ${targetWA} tidak dikirim ke gateway. Link direct: ${directWALink}`);
    return {
      success: false,
      simulated: true,
      wa_link: directWALink,
      error: "WA_GATEWAY_NOT_CONFIGURED",
    };
  }

  try {
    // Deteksi tipe gateway (Fonnte atau Generic/Waha)
    const isFonnte = gatewayUrl.includes("fonnte.com");

    let payload: Record<string, unknown>;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (isFonnte) {
      payload = {
        target: phone,
        message,
        countryCode: "62",
      };
      headers["Authorization"] = token;
    } else {
      // Waha / Baileys / Generic webhook
      payload = {
        phone,
        chatId: `${phone}@c.us`,
        message,
        text: message,
      };
      if (token) {
        headers["Authorization"] = `Bearer ${token}`;
        headers["X-API-Key"] = token;
      }
    }

    const res = await fetchFn(gatewayUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text();
      return { success: false, wa_link: directWALink, error: `Gateway returned ${res.status}: ${errText}` };
    }

    return { success: true, wa_link: directWALink };
  } catch (err) {
    return {
      success: false,
      wa_link: directWALink,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Dispatch Radar Alert ke semua pelanggan berstatus aktif di kota terkait.
 */
export async function dispatchRadarAlert(
  listing: ListingInsert,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  cityName = "Kota Terkait"
): Promise<{ matched: number; sent: number; failed: number }> {
  // 1. Ambil semua langganan aktif untuk kota ini
  const { data: subscribers, error } = await supabase
    .from("subscriptions")
    .select("id, user_wa, alert_criteria")
    .eq("city_id", listing.city_id)
    .eq("status", "active")
    .gt("expires_at", new Date().toISOString());

  if (error || !subscribers || subscribers.length === 0) {
    return { matched: 0, sent: 0, failed: 0 };
  }

  // 2. Cocokkan dengan kriteria alert tiap subscriber
  const matchedSubscribers = subscribers.filter((sub: ActiveSubscriber) =>
    isMatchingCriteria(sub.alert_criteria, listing)
  );

  if (matchedSubscribers.length === 0) {
    return { matched: 0, sent: 0, failed: 0 };
  }

  const message = formatAlertMessage(listing, cityName);
  let sent = 0;
  let failed = 0;

  // 3. Kirim alert ke masing-masing subscriber yang cocok
  for (const sub of matchedSubscribers) {
    const result = await sendWhatsAppMessage(sub.user_wa, message);
    if (result.success) {
      sent++;
    } else {
      failed++;
      console.error(`[radar-alert] Failed sending to ${sub.user_wa}:`, result.error);
    }
  }

  return { matched: matchedSubscribers.length, sent, failed };
}
