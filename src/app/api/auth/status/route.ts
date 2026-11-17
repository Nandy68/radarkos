import { type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { sha256 } from "@/lib/hash";
import { ACCESS_TOKEN_COOKIE } from "@/lib/constants";

/**
 * GET /api/auth/status?city=<slug>
 * Cek apakah user punya langganan aktif untuk kota tertentu.
 */
export async function GET(request: NextRequest) {
  const citySlug = request.nextUrl.searchParams.get("city");

  if (!citySlug) {
    return Response.json({ error: "Parameter 'city' wajib." }, { status: 400 });
  }

  // Cek cookie kosradar_session atau fallback legacy kr_token
  const token =
    request.cookies.get(ACCESS_TOKEN_COOKIE)?.value ||
    request.cookies.get("kosradar_session")?.value ||
    request.cookies.get("kr_token")?.value;

  if (!token) {
    return Response.json({
      is_active: false,
      reason: "no_token",
    });
  }

  const supabase = createAdminClient();

  // Resolve city
  const { data: city } = await supabase
    .from("cities")
    .select("id")
    .eq("slug", citySlug)
    .eq("is_active", true)
    .single();

  if (!city) {
    return Response.json({ error: "Kota tidak ditemukan." }, { status: 404 });
  }

  const tokenHash = await sha256(token);
  const { data: sub } = await supabase
    .from("subscriptions")
    .select("id, expires_at, user_wa")
    .eq("access_token_hash", tokenHash)
    .eq("city_id", city.id)
    .eq("status", "active")
    .gt("expires_at", new Date().toISOString())
    .limit(1)
    .maybeSingle();

  if (!sub) {
    return Response.json({
      is_active: false,
      reason: "no_active_subscription",
    });
  }

  return Response.json({
    is_active: true,
    expires_at: sub.expires_at,
    wa: sub.user_wa.slice(0, 4) + "****" + sub.user_wa.slice(-3),
  });
}
