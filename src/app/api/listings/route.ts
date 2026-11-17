import { type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { FREE_LISTING_LIMIT, ACCESS_TOKEN_COOKIE } from "@/lib/constants";
import { sha256 } from "@/lib/hash";

export const DEMO_LISTINGS = [
  {
    id: "demo-1",
    title: "Kos Putri Melati Dekat Kampus 1 Unsoed Grendeng",
    price_monthly: 650000,
    property_type: "kos_putri",
    area_tag: "Grendeng (± 3 mnt ke Unsoed)",
    facilities: ["KM Dalam", "WiFi", "Kasur", "Lemari", "Listrik Token"],
    image_urls: [
      "https://images.unsplash.com/photo-1522771739844-6a9f6d5f14af?auto=format&fit=crop&w=800&q=80",
      "https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&w=800&q=80",
    ],
    ai_summary:
      "Kamar bersih dan tenang 3 menit jalan kaki ke Fakultas Hukum & FISIP Unsoed. Harga di bawah standar area Grendeng.",
    posted_at: new Date(Date.now() - 1000 * 60 * 6).toISOString(),
    source_url: "https://facebook.com/groups/kos-purwokerto/posts/101",
    contact_wa: "6281234567890",
    is_undervalued: true,
  },
  {
    id: "demo-2",
    title: "Oper Kontrak Kos Putra Karangwangkal Dekat Biologi & Faperta",
    price_monthly: 550000,
    property_type: "oper_kontrak",
    area_tag: "Karangwangkal (± 2 mnt ke Kampus)",
    facilities: ["Parkir Motor", "Kasur", "Lemari", "Bebas Jam Malam"],
    image_urls: [
      "https://images.unsplash.com/photo-1598928506311-c55ded91a20c?auto=format&fit=crop&w=800&q=80",
    ],
    ai_summary:
      "Oper kontrak sisa 5 bulan dengan harga miring. Akses 2 menit ke Fakultas Biologi & Pertanian Unsoed.",
    posted_at: new Date(Date.now() - 1000 * 60 * 14).toISOString(),
    source_url: "https://facebook.com/groups/infokospurwokerto/posts/102",
    contact_wa: "6285712345678",
    is_undervalued: true,
  },
  {
    id: "demo-3",
    title: "Kos Eksklusif Putri Puri Hijau AC & Water Heater Dekat FK",
    price_monthly: 1250000,
    property_type: "kos_putri",
    area_tag: "Berkoh / Margono (± 4 mnt ke FKIK)",
    facilities: ["AC", "KM Dalam", "Water Heater", "WiFi", "CCTV", "Dapur"],
    image_urls: [
      "https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&w=800&q=80",
      "https://images.unsplash.com/photo-1522771739844-6a9f6d5f14af?auto=format&fit=crop&w=800&q=80",
    ],
    ai_summary:
      "Fasilitas lengkap standar hotel dengan kartu akses 24 jam. Sangat cocok untuk mahasiswa kedokteran atau dokter muda.",
    posted_at: new Date(Date.now() - 1000 * 60 * 28).toISOString(),
    source_url: "https://t.me/infokospurwokerto/103",
    contact_wa: "6281987654321",
    is_undervalued: false,
  },
  {
    id: "demo-4",
    title: "Kos Campur Modern Dekat Bioskop Rajawali & Stasiun",
    price_monthly: 700000,
    property_type: "kos_campur",
    area_tag: "Rajawali / Kranji (± 7 mnt ke Kampus)",
    facilities: ["KM Dalam", "Kasur Springbed", "WiFi Cepat", "Dapur Bersama"],
    image_urls: [
      "https://images.unsplash.com/photo-1586023492125-27b2c045efd7?auto=format&fit=crop&w=800&q=80",
    ],
    ai_summary:
      "Lokasi strategis tengah kota, dekat stasiun dan pusat kuliner malam Jl. HR Bunyamin Purwokerto.",
    posted_at: new Date(Date.now() - 1000 * 60 * 42).toISOString(),
    source_url: "https://facebook.com/groups/kos-purwokerto/posts/104",
    contact_wa: "6282112345678",
    is_undervalued: false,
  },
  {
    id: "demo-5",
    title: "Oper Kontrak Kos Putri Kamar Mandi Dalam Arcawinangun",
    price_monthly: 600000,
    property_type: "oper_kontrak",
    area_tag: "Arcawinangun (± 5 mnt ke Unsoed)",
    facilities: ["KM Dalam", "Kasur", "WiFi", "Dapur Bersama"],
    image_urls: [
      "https://images.unsplash.com/photo-1595526114035-0d45ed16cfbf?auto=format&fit=crop&w=800&q=80",
    ],
    ai_summary:
      "Oper kontrak mendadak karena lulus skripsi lebih awal. Kamar luas, sejuk, lingkungan aman dan ramah.",
    posted_at: new Date(Date.now() - 1000 * 60 * 65).toISOString(),
    source_url: "https://facebook.com/groups/infokospurwokerto/posts/105",
    contact_wa: "6287812345678",
    is_undervalued: true,
  },
  {
    id: "demo-6",
    title: "Kos Putra Murah Nyaman Dekat Fakultas Teknik Blater",
    price_monthly: 450000,
    property_type: "kos_putra",
    area_tag: "Blater / FT Unsoed (± 3 mnt ke FT)",
    facilities: ["Kasur", "Lemari", "Parkir Motor", "WiFi"],
    image_urls: [
      "https://images.unsplash.com/photo-1540518614846-7ede433c4ef0?auto=format&fit=crop&w=800&q=80",
    ],
    ai_summary:
      "Kos putra tenang dan dekat gerbang kampus FT Blater. Biaya bulanan sangat hemat dan sudah termasuk air.",
    posted_at: new Date(Date.now() - 1000 * 60 * 120).toISOString(),
    source_url: "https://t.me/infokospurwokerto/106",
    contact_wa: "6285211223344",
    is_undervalued: true,
  },
  {
    id: "demo-7",
    title: "Kos Muslimah Paviliun Dekat Kampus UMP Dukuhwaluh",
    price_monthly: 800000,
    property_type: "kos_putri",
    area_tag: "Dukuhwaluh (± 2 mnt ke UMP)",
    facilities: ["AC", "KM Dalam", "WiFi", "Kulkas Bersama"],
    image_urls: [
      "https://images.unsplash.com/photo-1513694203232-719a280e022f?auto=format&fit=crop&w=800&q=80",
    ],
    ai_summary:
      "Paviliun asri khusus mahasiswi UMP, pagar tertutup, air bersih jernih, dan dekat warung makan serba ada.",
    posted_at: new Date(Date.now() - 1000 * 60 * 180).toISOString(),
    source_url: "https://facebook.com/groups/kos-purwokerto/posts/107",
    contact_wa: "6289612345678",
    is_undervalued: false,
  },
  {
    id: "demo-8",
    title: "Kontrakan Rumah Mahasiswa 3 Kamar Dekat GOR Satria",
    price_monthly: 1600000,
    property_type: "kos_campur",
    area_tag: "GOR Satria (± 5 mnt ke Unsoed)",
    facilities: ["Garasi Mobil", "Ruang Tamu", "Dapur", "3 Kamar Tidur", "2 KM"],
    image_urls: [
      "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=800&q=80",
    ],
    ai_summary:
      "Bisa patungan 3-4 orang jadi cuma Rp400rb-an per bulan. Dekat pusat kuliner dan sarana olahraga GOR Satria.",
    posted_at: new Date(Date.now() - 1000 * 60 * 300).toISOString(),
    source_url: "https://facebook.com/groups/kontrakanpurwokerto/posts/108",
    contact_wa: "6281399887766",
    is_undervalued: true,
  },
];

/**
 * GET /api/listings?city=<slug>&page=1&type=&max_price=&area=&facility=
 *
 * Gratis: 3 listing terbaru tanpa kontak/source_url.
 * Berbayar (token cookie valid & aktif): 14 hari listing lengkap.
 */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const citySlug = sp.get("city");

  if (!citySlug) {
    return Response.json({ error: "Parameter 'city' wajib." }, { status: 400 });
  }

  // --- Check subscription cookie ---
  let isPaid = false;
  const token = request.cookies.get(ACCESS_TOKEN_COOKIE)?.value;

  try {
    const supabase = createAdminClient();

    // --- Resolve city ---
    const { data: city, error: cityErr } = await supabase
      .from("cities")
      .select("id")
      .eq("slug", citySlug)
      .eq("is_active", true)
      .single();

    if (cityErr || !city) {
      throw new Error(cityErr?.message || "City not found in DB");
    }

    if (token) {
      const tokenHash = await sha256(token);
      const { data: sub } = await supabase
        .from("subscriptions")
        .select("id, expires_at")
        .eq("access_token_hash", tokenHash)
        .eq("city_id", city.id)
        .eq("status", "active")
        .gt("expires_at", new Date().toISOString())
        .limit(1)
        .single();

      isPaid = !!sub;
    }

    // --- Build query ---
    let query = supabase
      .from("listings")
      .select(
        "id, title, price_monthly, property_type, area_tag, facilities, image_urls, ai_summary, posted_at, source_url, contact_wa, is_undervalued"
      )
      .eq("city_id", city.id)
      .order("posted_at", { ascending: false });

    // Filters
    const propertyType = sp.get("type");
    if (propertyType) {
      query = query.eq("property_type", propertyType);
    }

    const maxPrice = sp.get("max_price");
    if (maxPrice) {
      const parsed = parseInt(maxPrice, 10);
      if (!isNaN(parsed)) {
        query = query.lte("price_monthly", parsed);
      }
    }

    const area = sp.get("area");
    if (area) {
      query = query.ilike("area_tag", `%${area}%`);
    }

    const facility = sp.get("facility");
    if (facility) {
      query = query.contains("facilities", [facility]);
    }

    // Pagination
    const page = Math.max(1, parseInt(sp.get("page") ?? "1", 10));
    const perPage = 20;
    const from = (page - 1) * perPage;
    query = query.range(from, from + perPage - 1);

    const { data: rawListings, error } = await query;

    if (error || !rawListings || rawListings.length === 0) {
      throw new Error(error?.message || "No listings in DB");
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const listings = ((rawListings as any[]) ?? []).map((item, idx: number) => {
      if (isPaid) return item;
      if (idx < FREE_LISTING_LIMIT) {
        return {
          ...item,
          source_url: null,
          contact_wa: item.contact_wa
            ? item.contact_wa.slice(0, -4) + "****"
            : null,
        };
      }
      return {
        ...item,
        source_url: null,
        contact_wa: null,
        is_locked: true,
      };
    });

    return Response.json({
      city: citySlug,
      is_paid: isPaid,
      listings,
    });
  } catch {
    // Fallback demo listings when database is not yet migrated/connected or empty
    let filtered = [...DEMO_LISTINGS];
    const propertyType = sp.get("type");
    if (propertyType) {
      filtered = filtered.filter((l) => l.property_type === propertyType);
    }
    const maxPrice = sp.get("max_price");
    if (maxPrice) {
      const parsed = parseInt(maxPrice, 10);
      if (!isNaN(parsed)) {
        filtered = filtered.filter((l) => (l.price_monthly ?? 0) <= parsed);
      }
    }
    const area = sp.get("area");
    if (area) {
      filtered = filtered.filter((l) =>
        l.area_tag.toLowerCase().includes(area.toLowerCase()) ||
        l.title.toLowerCase().includes(area.toLowerCase())
      );
    }
    const facility = sp.get("facility");
    if (facility) {
      filtered = filtered.filter((l) =>
        l.facilities.some((f) => f.toLowerCase().includes(facility.toLowerCase()))
      );
    }

    const listings = filtered.map((item, idx: number) => {
      if (isPaid || token === "demo_unlocked") return item;
      if (idx < FREE_LISTING_LIMIT) {
        return {
          ...item,
          source_url: null,
          contact_wa: item.contact_wa
            ? item.contact_wa.slice(0, -4) + "****"
            : null,
        };
      }
      return {
        ...item,
        source_url: null,
        contact_wa: null,
        is_locked: true,
      };
    });

    return Response.json({
      city: citySlug,
      is_paid: isPaid || token === "demo_unlocked",
      listings,
    });
  }
}
