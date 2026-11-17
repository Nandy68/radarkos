import { type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { sha256, generateToken } from "@/lib/hash";
import {
  CLAIM_NONCE_COOKIE,
  ACCESS_TOKEN_COOKIE,
} from "@/lib/constants";

/**
 * GET /api/auth/claim?token=<token>
 * Dipanggil saat user mengklik tautan pemulihan akses dari WhatsApp / modal recovery.
 */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");

  if (!token) {
    return Response.json(
      { error: "Token klaim tidak ditemukan." },
      { status: 400 }
    );
  }

  const supabase = createAdminClient();
  const tokenHash = await sha256(token);

  // Cari langganan aktif
  const { data: sub } = await supabase
    .from("subscriptions")
    .select("id, city_id, expires_at, status")
    .eq("access_token_hash", tokenHash)
    .eq("status", "active")
    .gt("expires_at", new Date().toISOString())
    .single();

  if (!sub) {
    return Response.json(
      { error: "Tautan akses tidak valid atau sudah kedaluwarsa." },
      { status: 403 }
    );
  }

  // Cari kota untuk redirect
  const { data: city } = await supabase
    .from("cities")
    .select("slug")
    .eq("id", sub.city_id)
    .single();

  // Hitung sisa waktu cookie
  const maxAge = Math.max(
    0,
    Math.floor((new Date(sub.expires_at).getTime() - Date.now()) / 1000)
  );

  const headers = new Headers();
  const isProd = process.env.NODE_ENV === "production";
  headers.append(
    "Set-Cookie",
    `${ACCESS_TOKEN_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${isProd ? "; Secure" : ""}`
  );

  // Redirect ke halaman utama kota
  const targetUrl = new URL(`/?city=${city?.slug || "purwokerto"}&unlocked=1`, request.url);
  headers.set("Location", targetUrl.toString());

  return new Response(null, { status: 302, headers });
}

/**
 * POST /api/auth/claim
 * Body: { order_id?: string, token?: string }
 *
 * Dipanggil setelah pembayaran Midtrans Snap sukses di browser untuk langsung
 * memasang cookie session `kosradar_session`.
 */
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { order_id, token } = body as { order_id?: string; token?: string };

  const supabase = createAdminClient();

  // Kasus 1: Klaim via token langsung
  if (token) {
    const tokenHash = await sha256(token);
    const { data: sub } = await supabase
      .from("subscriptions")
      .select("id, city_id, expires_at")
      .eq("access_token_hash", tokenHash)
      .eq("status", "active")
      .gt("expires_at", new Date().toISOString())
      .single();

    if (!sub) {
      return Response.json({ error: "Token tidak valid." }, { status: 403 });
    }

    const maxAge = Math.max(
      0,
      Math.floor((new Date(sub.expires_at).getTime() - Date.now()) / 1000)
    );

    const headers = new Headers();
    const isProd = process.env.NODE_ENV === "production";
    headers.append(
      "Set-Cookie",
      `${ACCESS_TOKEN_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${isProd ? "; Secure" : ""}`
    );

    return Response.json({ success: true, expires_at: sub.expires_at }, { headers });
  }

  // Kasus 2: Klaim via order_id setelah Snap settlement
  if (!order_id) {
    return Response.json({ error: "Field 'order_id' atau 'token' wajib." }, { status: 400 });
  }

  // Cari subscription berdasarkan midtrans_order_id
  const { data: sub, error: subErr } = await supabase
    .from("subscriptions")
    .select("id, status, city_id, claim_nonce_hash, access_token_hash, expires_at")
    .eq("midtrans_order_id", order_id)
    .single();

  if (subErr || !sub) {
    return Response.json({ error: "Pesanan tidak ditemukan." }, { status: 404 });
  }

  // Verifikasi claim nonce (browser binding) untuk mencegah hijack order_id
  if (sub.claim_nonce_hash) {
    const cookieNonce = request.cookies.get(CLAIM_NONCE_COOKIE)?.value;
    if (!cookieNonce) {
      return Response.json(
        {
          error:
            "Klaim ditolak: Cookie sesi checkout (kr_nonce) tidak ditemukan di browser ini. Silakan gunakan link akses yang dikirimkan ke WhatsApp Anda.",
          code: "NONCE_COOKIE_MISSING",
        },
        { status: 403 }
      );
    }

    const cookieNonceHash = await sha256(cookieNonce);
    if (cookieNonceHash !== sub.claim_nonce_hash) {
      return Response.json(
        {
          error:
            "Klaim ditolak: Sesi browser tidak cocok dengan sesi checkout. Silakan gunakan link akses yang dikirimkan ke WhatsApp Anda.",
          code: "NONCE_MISMATCH",
        },
        { status: 403 }
      );
    }
  }

  // Cek apakah sudah active
  if (sub.status !== "active") {
    return Response.json(
      { error: "Pembayaran belum dikonfirmasi. Tunggu beberapa saat." },
      { status: 402 }
    );
  }

  // Buat access_token jika belum ada
  const accessToken = generateToken(32);
  const tokenHash = await sha256(accessToken);
  await supabase
    .from("subscriptions")
    .update({ access_token_hash: tokenHash })
    .eq("id", sub.id);

  // Ambil data kota
  const { data: city } = await supabase
    .from("cities")
    .select("slug")
    .eq("id", sub.city_id)
    .single();

  const maxAge = Math.max(
    0,
    Math.floor((new Date(sub.expires_at).getTime() - Date.now()) / 1000)
  );

  const headers = new Headers();
  const isProd = process.env.NODE_ENV === "production";

  // Pasang cookie session utama
  headers.append(
    "Set-Cookie",
    `${ACCESS_TOKEN_COOKIE}=${accessToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${isProd ? "; Secure" : ""}`
  );

  // Bersihkan claim nonce
  headers.append(
    "Set-Cookie",
    `${CLAIM_NONCE_COOKIE}=; Path=/; HttpOnly; Max-Age=0`
  );

  return Response.json(
    {
      success: true,
      city_slug: city?.slug,
      expires_at: sub.expires_at,
    },
    { headers }
  );
}
