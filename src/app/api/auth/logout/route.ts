import { type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { sha256 } from "@/lib/hash";
import { ACCESS_TOKEN_COOKIE } from "@/lib/constants";

/**
 * POST /api/auth/logout
 * Revoke device token dan hapus cookie.
 */
export async function POST(request: NextRequest) {
  const deviceToken = request.cookies.get("kr_device")?.value;

  if (deviceToken) {
    const supabase = createAdminClient();
    const deviceHash = await sha256(deviceToken);

    // Revoke device
    await supabase
      .from("subscription_devices")
      .update({ revoked_at: new Date().toISOString() })
      .eq("device_token_hash", deviceHash)
      .is("revoked_at", null);
  }

  // Clear cookies
  const headers = new Headers();
  headers.append(
    "Set-Cookie",
    `${ACCESS_TOKEN_COOKIE}=; Path=/; HttpOnly; Max-Age=0`
  );
  headers.append(
    "Set-Cookie",
    `kr_device=; Path=/; HttpOnly; Max-Age=0`
  );

  return Response.json({ success: true }, { headers });
}

