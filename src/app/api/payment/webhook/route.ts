import { type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { sha256, generateToken } from "@/lib/hash";
import {
  ACCESS_TOKEN_COOKIE,
  MIDTRANS_SERVER_KEY,
} from "@/lib/constants";
import crypto from "crypto";

/**
 * Verifikasi signature Midtrans (SHA-512 standard & fallback SHA-256).
 */
function verifyMidtransSignature(
  orderId: string,
  statusCode: string,
  grossAmount: string,
  signatureKey: string
): boolean {
  const payload = `${orderId}${statusCode}${grossAmount}${MIDTRANS_SERVER_KEY}`;

  // Standard Midtrans: SHA-512
  const sha512Hash = crypto.createHash("sha512").update(payload).digest("hex");
  if (signatureKey.toLowerCase() === sha512Hash.toLowerCase()) {
    return true;
  }

  // Fallback: SHA-256
  const sha256Hash = crypto.createHash("sha256").update(payload).digest("hex");
  if (signatureKey.toLowerCase() === sha256Hash.toLowerCase()) {
    return true;
  }

  return false;
}

/**
 * POST /api/payment/webhook
 * Midtrans HTTP Notification Webhook Handler.
 */
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const {
    order_id,
    transaction_status,
    fraud_status,
    status_code,
    gross_amount,
    signature_key,
  } = body as {
    order_id?: string;
    transaction_status?: string;
    fraud_status?: string;
    status_code?: string;
    gross_amount?: string;
    signature_key?: string;
  };

  if (!order_id || !transaction_status || !signature_key || !status_code || !gross_amount) {
    return Response.json({ error: "Field notifikasi tidak lengkap." }, { status: 400 });
  }

  // Verifikasi signature
  const isValid = verifyMidtransSignature(
    order_id,
    status_code,
    gross_amount,
    signature_key
  );

  if (!isValid) {
    console.error("[payment-webhook] Signature mismatch for order:", order_id);
    return Response.json({ error: "Invalid signature" }, { status: 403 });
  }

  const supabase = createAdminClient();

  // Status: settlement / capture (kartu kredit)
  if (
    transaction_status === "capture" ||
    transaction_status === "settlement"
  ) {
    if (transaction_status === "capture" && fraud_status !== "accept") {
      return Response.json({ message: "Menunggu review fraud." });
    }

    // Aktifkan langganan 14 hari
    const { data: sub, error: activateErr } = await supabase.rpc(
      "activate_subscription",
      {
        p_order_id: order_id,
      }
    );

    if (activateErr) {
      console.error("[payment-webhook] activate_subscription error:", activateErr);
      return Response.json({ error: "Gagal mengaktifkan langganan." }, { status: 500 });
    }

    // Buat token akses jika belum ada
    const rawAccessToken = generateToken(32);
    const tokenHash = await sha256(rawAccessToken);

    if (sub) {
      await supabase
        .from("subscriptions")
        .update({ access_token_hash: tokenHash })
        .eq("id", sub.id);
    }

    // Siapkan Set-Cookie HTTP-only kosradar_session (14 hari)
    const headers = new Headers();
    const maxAge = 14 * 24 * 3600; // 14 hari

    headers.append(
      "Set-Cookie",
      `${ACCESS_TOKEN_COOKIE}=${rawAccessToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}; Secure`
    );

    return Response.json(
      {
        message: "Langganan berhasil diaktifkan 14 hari.",
        status: "active",
        order_id,
      },
      { headers }
    );
  }

  // Status: cancel / deny / expire
  if (
    transaction_status === "cancel" ||
    transaction_status === "deny" ||
    transaction_status === "expire"
  ) {
    await supabase
      .from("subscriptions")
      .update({ status: "expired" })
      .eq("midtrans_order_id", order_id)
      .eq("status", "pending");

    return Response.json({ message: "Pesanan kedaluwarsa/dibatalkan.", status: "expired" });
  }

  // Pending dsb.
  return Response.json({ message: "Status diterima.", status: transaction_status });
}
