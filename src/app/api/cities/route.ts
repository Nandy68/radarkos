import { createAdminClient } from "@/lib/supabase/server";

const FALLBACK_CITIES = [
  { id: "1", name: "Purwokerto (Unsoed)", slug: "purwokerto" },
  { id: "2", name: "Semarang (Undip/Unnes)", slug: "semarang" },
  { id: "3", name: "Yogyakarta (UGM/UNY)", slug: "yogyakarta" },
  { id: "4", name: "Malang (UB/UM)", slug: "malang" },
  { id: "5", name: "Solo (UNS)", slug: "solo" },
];

/**
 * GET /api/cities
 * Daftar kota aktif. Publik (RLS allow select on cities where is_active).
 */
export async function GET() {
  try {
    const supabase = createAdminClient();

    const { data, error } = await supabase
      .from("cities")
      .select("id, name, slug")
      .eq("is_active", true)
      .order("name");

    if (error || !data || data.length === 0) {
      return Response.json(FALLBACK_CITIES, {
        headers: {
          "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
        },
      });
    }

    return Response.json(data, {
      headers: {
        "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
      },
    });
  } catch {
    return Response.json(FALLBACK_CITIES, {
      headers: {
        "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
      },
    });
  }
}

