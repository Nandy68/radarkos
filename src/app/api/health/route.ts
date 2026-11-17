import { NextResponse } from "next/server";
import { isSupabaseConfigured, createAdminClient } from "@/lib/supabase/server";

export async function GET() {
  const supabaseConfigured = isSupabaseConfigured();
  let supabaseConnected = false;
  let supabaseError: string | null = null;

  if (supabaseConfigured) {
    try {
      const supabase = createAdminClient();
      const { data, error } = await supabase.from("cities").select("id").limit(1);
      if (error) {
        supabaseError = error.message;
      } else {
        supabaseConnected = Boolean(data);
      }
    } catch (err) {
      supabaseError = err instanceof Error ? err.message : String(err);
    }
  }

  const midtransConfigured = Boolean(
    process.env.MIDTRANS_SERVER_KEY &&
    process.env.MIDTRANS_SERVER_KEY.trim() !== ""
  );

  const waGatewayConfigured = Boolean(
    process.env.WA_GATEWAY_URL &&
    process.env.WA_GATEWAY_URL.trim() !== ""
  );

  const cronConfigured = Boolean(
    process.env.CRON_SECRET || process.env.INGEST_SECRET_KEY
  );

  return NextResponse.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    services: {
      supabase: {
        configured: supabaseConfigured,
        connected: supabaseConnected,
        error: supabaseError,
      },
      midtrans: {
        configured: midtransConfigured,
        is_production: process.env.MIDTRANS_IS_PRODUCTION === "true",
      },
      wa_gateway: {
        configured: waGatewayConfigured,
      },
      cron: {
        configured: cronConfigured,
      },
    },
  });
}
