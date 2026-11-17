import { createServerClient } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

/**
 * Cek apakah kredensial Supabase sudah dikonfigurasi dengan benar (bukan nilai placeholder).
 */
export function isSupabaseConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return Boolean(
    url &&
    key &&
    !url.includes("placeholder.supabase.co") &&
    key !== "placeholder-service-key"
  );
}

/**
 * Supabase client for Route Handlers & Server Components.
 * Uses the anon key — RLS applies.
 */
export async function createClient() {
  const cookieStore = await cookies();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder-anon-key";

  return createServerClient(
    url,
    anonKey,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // setAll can throw in Server Components — safe to ignore.
          }
        },
      },
    }
  );
}

/**
 * Supabase admin client — bypasses RLS.
 * Use ONLY in Route Handlers / server actions that need full DB access.
 */
export function createAdminClient() {
  const isConfigured = isSupabaseConfigured();
  if (!isConfigured && process.env.NODE_ENV !== "test") {
    console.warn(
      "[supabase] Kredensial SUPABASE_SERVICE_ROLE_KEY atau NEXT_PUBLIC_SUPABASE_URL belum diatur. Menggunakan client dummy."
    );
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "placeholder-service-key";
  return createSupabaseClient(url, key, { auth: { persistSession: false } });
}


