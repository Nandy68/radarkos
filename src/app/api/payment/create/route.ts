import { type NextRequest } from "next/server";
import { createAdminClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { normalizeWA } from "@/lib/wa";
import { sha256, generateToken } from "@/lib/hash";
import { snap } from "@/lib/midtrans";
import {
  SUBSCRIPTION_PRICE,
  CLAIM_NONCE_COOKIE,
} from "@/lib/constants";

/**
 * POST /api/payment/create
 *
 * Menerima:
 * { wa: string, city_slug: string, alert_criteria?: object }
 *
 * Harga flat Rp10.000 untuk 14 hari akses.
 */
export async function POST(request: NextRequest) {
  // 1. Cek konfigurasi dependency kritis
  if (!isSupabaseConfigured()) {
    return Response.json(
      {
        error: "Konfigurasi database belum lengkap: SUPABASE_SERVICE_ROLE_KEY belum diisi di Environment Variables server.",
        code: "SUPABASE_NOT_CONFIGURED",
      },
      { status: 503 }
    );
  }

  if (!process.env.MIDTRANS_SERVER_KEY || !process.env.MIDTRANS_SERVER_KEY.trim()) {
    return Response.json(
      {
        error: "Konfigurasi payment gateway belum lengkap: MIDTRANS_SERVER_KEY belum diisi di Environment Variables server.",
        code: "MIDTRANS_NOT_CONFIGURED",
      },
      { status: 503 }
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Body JSON tidak valid." }, { status: 400 });
  }

  const { wa, city_slug, alert_criteria } = body as {
    wa?: string;
    city_slug?: string;
    alert_criteria?: Record<string, unknown>;
  };

  // Validasi input
  if (!wa || !city_slug) {
    return Response.json(
      { error: "Field 'wa' dan 'city_slug' wajib diisi." },
      { status: 400 }
    );
  }

  const normalizedWA = normalizeWA(wa);
  if (!normalizedWA) {
    return Response.json(
      { error: "Nomor WhatsApp tidak valid (contoh: 081234567890)." },
      { status: 400 }
    );
  }

  const supabase = createAdminClient();

  // Resolve kota
  const { data: city, error: cityErr } = await supabase
    .from("cities")
    .select("id, name")
    .eq("slug", city_slug)
    .eq("is_active", true)
    .single();

  if (cityErr || !city) {
    if (
      cityErr?.message?.includes("does not exist") ||
      cityErr?.message?.includes("schema cache")
    ) {
      return Response.json(
        {
          error:
            "Tabel database Supabase belum diinisialisasi. Silakan jalankan file supabase/schema.sql di Supabase SQL Editor.",
          code: "DATABASE_TABLES_MISSING",
        },
        { status: 500 }
      );
    }
    return Response.json({ error: "Kota tidak ditemukan." }, { status: 404 });
  }

  // Cek apakah user sudah punya langganan aktif
  const { data: existing } = await supabase
    .from("subscriptions")
    .select("id, expires_at")
    .eq("user_wa", normalizedWA)
    .eq("city_id", city.id)
    .eq("status", "active")
    .gt("expires_at", new Date().toISOString())
    .limit(1)
    .single();

  if (existing) {
    return Response.json(
      {
        error: "Anda sudah memiliki langganan aktif untuk kota ini.",
        expires_at: existing.expires_at,
      },
      { status: 409 }
    );
  }

  // Order ID menggunakan cryptographically secure random token (12 bytes hex)
  const orderId = `KR-${city.id}-${Date.now()}-${generateToken(12)}`;

  // Claim nonce untuk browser binding
  const claimNonce = generateToken(16);
  const claimNonceHash = await sha256(claimNonce);

  // Buat record pending di database (flat Rp10.000)
  const { data: sub, error: subErr } = await supabase
    .from("subscriptions")
    .insert({
      user_wa: normalizedWA,
      city_id: city.id,
      alert_criteria: alert_criteria ?? {},
      status: "pending",
      midtrans_order_id: orderId,
      gross_amount: SUBSCRIPTION_PRICE,
      claim_nonce_hash: claimNonceHash,
    })
    .select("id, midtrans_order_id")
    .single();

  if (subErr) {
    console.error("Payment create insert error:", subErr);
    return Response.json(
      { error: "Gagal membuat pesanan." },
      { status: 500 }
    );
  }

  // Panggil Midtrans Snap API
  let snapToken: string;
  try {
    const txn = await snap.createTransaction({
      transaction_details: {
        order_id: orderId,
        gross_amount: SUBSCRIPTION_PRICE,
      },
      customer_details: {
        phone: normalizedWA,
      },
      item_details: [
        {
          id: `kos-${city.id}`,
          price: SUBSCRIPTION_PRICE,
          quantity: 1,
          name: `Akses KosRadar ${city.name} 14 Hari`,
        },
      ],
    } as unknown as Parameters<typeof snap.createTransaction>[0]);

    snapToken = txn.token;
  } catch (err) {
    console.error("Midtrans Snap error:", err);
    await supabase.from("subscriptions").delete().eq("id", sub.id);
    return Response.json(
      {
        error: "Gagal membuat transaksi pembayaran Midtrans. Pastikan kredensial Midtrans Server Key valid.",
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 502 }
    );
  }

  // Set HTTP-only cookie claim nonce
  const headers = new Headers();
  headers.append(
    "Set-Cookie",
    `${CLAIM_NONCE_COOKIE}=${claimNonce}; Path=/; HttpOnly; SameSite=Lax; Max-Age=3600; Secure`
  );

  return Response.json(
    {
      snap_token: snapToken,
      order_id: orderId,
      gross_amount: SUBSCRIPTION_PRICE,
    },
    { headers }
  );
}
