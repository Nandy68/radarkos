import { type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { normalizeWA } from "@/lib/wa";
import { sha256, generateToken } from "@/lib/hash";
import { sendWhatsAppMessage } from "@/lib/radar/notifier";

/**
 * POST /api/auth/recover
 * Body: { wa: string }
 *
 * Pulihkan Akses Tanpa Password:
 * 1. Menerima nomor WhatsApp pengguna.
 * 2. Cek langganan aktif di tabel `subscriptions`.
 * 3. Jika ada, generate access_token baru, simpan hash ke DB.
 * 4. Kirim link klaim `/api/auth/claim?token=...` ke WhatsApp user.
 * 5. Return claim_url di response agar mudah dites langsung di dev/sandbox.
 */
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { wa } = body as { wa?: string };

  if (!wa || !wa.trim()) {
    return Response.json(
      { error: "Masukkan nomor WhatsApp yang pernah digunakan untuk pembayaran." },
      { status: 400 }
    );
  }

  const normalizedWA = normalizeWA(wa);
  if (!normalizedWA) {
    return Response.json(
      { error: "Format nomor WhatsApp tidak valid (contoh: 081234567890)." },
      { status: 400 }
    );
  }

  const supabase = createAdminClient();

  // Cari langganan yang masih aktif
  const { data: sub, error } = await supabase
    .from("subscriptions")
    .select("id, city_id, expires_at, status")
    .eq("user_wa", normalizedWA)
    .eq("status", "active")
    .gt("expires_at", new Date().toISOString())
    .order("expires_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !sub) {
    return Response.json(
      {
        error:
          "Tidak ditemukan langganan aktif untuk nomor WhatsApp ini. Pastikan Anda memasukkan nomor yang sama saat checkout.",
      },
      { status: 404 }
    );
  }

  // Generate token akses baru
  const accessToken = generateToken(32);
  const tokenHash = await sha256(accessToken);

  await supabase
    .from("subscriptions")
    .update({ access_token_hash: tokenHash })
    .eq("id", sub.id);

  // Ambil origin untuk membuat full URL klaim
  const origin = request.nextUrl.origin || "http://localhost:3000";
  const claimUrl = `${origin}/api/auth/claim?token=${accessToken}`;

  const formattedExpiry = new Date(sub.expires_at).toLocaleDateString("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const waMessage =
    `⚡ *[KOSRADAR — PEMULIHAN AKSES]* ⚡\n\n` +
    `Halo! Berikut tautan resmi untuk memulihkan akses radar kos Anda:\n` +
    `👉 ${claimUrl}\n\n` +
    `Akses aktif s/d: *${formattedExpiry}*.\n` +
    `Klik tautan di atas untuk langsung membuka sensor kontak nomor pemilik & link postingan asli.\n\n` +
    `_KosRadar — Radar Kos & Oper Kontrak_`;

  // Kirim pesan WhatsApp
  await sendWhatsAppMessage(normalizedWA, waMessage);

  return Response.json({
    success: true,
    message: "Tautan akses berhasil dikirim ke nomor WhatsApp Anda.",
    claim_url: claimUrl,
    expires_at: sub.expires_at,
  });
}
