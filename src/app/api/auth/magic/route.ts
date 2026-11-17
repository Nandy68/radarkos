import { type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { sha256 } from "@/lib/hash";
import { ACCESS_TOKEN_COOKIE } from "@/lib/constants";

/**
 * GET /api/auth/magic?token=<raw_access_token>
 *
 * Magic link: user membuka link ini di browser lain.
 * Memverifikasi token, cek device limit, register device, set cookie.
 */
export async function GET(request: NextRequest) {
  const rawToken = request.nextUrl.searchParams.get("token");

  if (!rawToken) {
    return Response.json({ error: "Token tidak ditemukan." }, { status: 400 });
  }

  const supabase = createAdminClient();
  const tokenHash = await sha256(rawToken);

  // Find active subscription
  const { data: sub } = await supabase
    .from("subscriptions")
    .select("id, city_id, expires_at")
    .eq("access_token_hash", tokenHash)
    .eq("status", "active")
    .gt("expires_at", new Date().toISOString())
    .single();

  if (!sub) {
    return Response.json(
      { error: "Token tidak valid atau sudah expired." },
      { status: 403 }
    );
  }

  // Register device
  const { generateToken } = await import("@/lib/hash");
  const deviceToken = generateToken(16);
  const deviceTokenHash = await sha256(deviceToken);
  const userAgent = request.headers.get("user-agent") ?? "";

  const { error: deviceErr } = await supabase
    .from("subscription_devices")
    .insert({
      subscription_id: sub.id,
      device_token_hash: deviceTokenHash,
      user_agent: userAgent,
    });

  if (deviceErr?.message?.includes("DEVICE_LIMIT_REACHED")) {
    return Response.json(
      { error: "Batas 2 perangkat tercapai. Logout dari perangkat lain dulu." },
      { status: 429 }
    );
  }

  // Get city slug
  const { data: city } = await supabase
    .from("cities")
    .select("slug")
    .eq("id", sub.city_id)
    .single();

  // Set cookies
  const maxAge = Math.max(
    0,
    Math.floor(
      (new Date(sub.expires_at).getTime() - Date.now()) / 1000
    )
  );

  const headers = new Headers();
  headers.append(
    "Set-Cookie",
    `${ACCESS_TOKEN_COOKIE}=${rawToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}; Secure`
  );
  headers.append(
    "Set-Cookie",
    `kr_device=${deviceToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}; Secure`
  );

  // Redirect to city feed
  const targetCity = city?.slug || "purwokerto";
  const redirectUrl = new URL(`/?city=${targetCity}&unlocked=1`, request.url);
  headers.set("Location", redirectUrl.toString());

  return new Response(null, { status: 302, headers });
}

