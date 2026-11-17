import { type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { sha256, generateToken } from "@/lib/hash";
import {
  ACCESS_TOKEN_COOKIE,
  MIDTRANS_SERVER_KEY,
} from "@/lib/constants";

/**
 * POST /api/webhooks/midtrans
 * Midtrans HTTP Notification handler.
 */
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
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

  if (!order_id || !transaction_status || !signature_key) {
    return Response.json({ error: "Missing fields" }, { status: 400 });
  }

  // --- Verify signature ---
  const expectedSig = await sha256(
    `${order_id}${status_code}${gross_amount}${MIDTRANS_SERVER_KEY}`
  );
  if (signature_key !== expectedSig) {
    console.error("Midtrans signature mismatch", { order_id });
    return Response.json({ error: "Invalid signature" }, { status: 403 });
  }

  const supabase = createAdminClient();

  // --- Handle transaction status ---
  if (
    transaction_status === "capture" ||
    transaction_status === "settlement"
  ) {
    if (transaction_status === "capture" && fraud_status !== "accept") {
      return Response.json({ message: "Waiting for fraud review" });
    }

    // Activate subscription using DB function
    const { data: sub, error: activateErr } = await supabase.rpc(
      "activate_subscription",
      {
        p_order_id: order_id,
      }
    );

    if (activateErr) {
      console.error("activate_subscription error:", activateErr);
      return Response.json(
        { error: "Failed to activate" },
        { status: 500 }
      );
    }

    // Generate access token if not yet set
    const accessToken = generateToken(32);
    const tokenHash = await sha256(accessToken);

    if (sub) {
      await supabase
        .from("subscriptions")
        .update({ access_token_hash: tokenHash })
        .eq("id", sub.id);
    }

    const headers = new Headers();
    const maxAge = 14 * 24 * 3600;
    headers.append(
      "Set-Cookie",
      `${ACCESS_TOKEN_COOKIE}=${accessToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}; Secure`
    );

    return Response.json({ message: "OK", status: "activated" }, { headers });
  }

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

    return Response.json({ message: "OK", status: "cancelled" });
  }

  return Response.json({ message: "OK", status: transaction_status });
}
