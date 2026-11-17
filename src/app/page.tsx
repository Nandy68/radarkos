"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import {
  Zap,
  MapPin,
  ChevronDown,
  ChevronUp,
  Search,
  X,
  ArrowLeftRight,
  Compass,
  Check,
  LockOpen,
  Radar,
} from "lucide-react";
import { Navbar } from "@/components/Navbar";
import { ListingCard, type ListingItem } from "@/components/ListingCard";
import { CheckoutModal } from "@/components/CheckoutModal";
import { RecoveryModal } from "@/components/RecoveryModal";
import { SUPPORTED_CITIES, type CityOption } from "@/lib/format";

type FilterChip = "all" | "oper_kontrak" | "under_700" | "km_dalam" | "ac" | "bebas_jam";

export default function HomePage() {
  const [selectedCity, setSelectedCity] = useState<CityOption>(SUPPORTED_CITIES[0]);
  const [activeFilter, setActiveFilter] = useState<FilterChip>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [listings, setListings] = useState<ListingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [isPaid, setIsPaid] = useState(false);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [isRecoveryOpen, setIsRecoveryOpen] = useState(false);
  const [isCityOpen, setIsCityOpen] = useState(false);

  const reloadData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("city", selectedCity.slug);
      if (activeFilter === "oper_kontrak") params.set("type", "oper_kontrak");
      else if (activeFilter === "under_700") params.set("max_price", "700000");
      else if (activeFilter === "km_dalam") params.set("facility", "kamar mandi dalam");
      else if (activeFilter === "ac") params.set("facility", "ac");

      const [authRes, listRes] = await Promise.all([
        fetch(`/api/auth/status?city=${selectedCity.slug}`),
        fetch(`/api/listings?${params.toString()}`),
      ]);

      if (authRes.ok) {
        const authData = await authRes.json();
        setIsPaid(!!authData.is_active);
        setExpiresAt(authData.expires_at || null);
      }

      if (listRes.ok) {
        const listData = await listRes.json();
        setListings(listData.listings || []);
        if (listData.is_paid !== undefined) setIsPaid(!!listData.is_paid);
      } else {
        setListings([]);
      }
    } catch {
      setListings([]);
    } finally {
      setLoading(false);
    }
  }, [selectedCity.slug, activeFilter]);

  useEffect(() => {
    let active = true;
    async function loadData() {
      try {
        const params = new URLSearchParams();
        params.set("city", selectedCity.slug);
        if (activeFilter === "oper_kontrak") params.set("type", "oper_kontrak");
        else if (activeFilter === "under_700") params.set("max_price", "700000");
        else if (activeFilter === "km_dalam") params.set("facility", "kamar mandi dalam");
        else if (activeFilter === "ac") params.set("facility", "ac");

        const [authRes, listRes] = await Promise.all([
          fetch(`/api/auth/status?city=${selectedCity.slug}`),
          fetch(`/api/listings?${params.toString()}`),
        ]);
        if (!active) return;

        if (authRes.ok) {
          const authData = await authRes.json();
          setIsPaid(!!authData.is_active);
          setExpiresAt(authData.expires_at || null);
        }
        if (listRes.ok) {
          const listData = await listRes.json();
          setListings(listData.listings || []);
          if (listData.is_paid !== undefined) setIsPaid(!!listData.is_paid);
        } else {
          setListings([]);
        }
      } catch {
        if (active) setListings([]);
      } finally {
        if (active) setLoading(false);
      }
    }
    void loadData();
    return () => { active = false; };
  }, [selectedCity.slug, activeFilter]);

  const filteredListings = useMemo(() => {
    if (!searchQuery.trim()) return listings;
    const q = searchQuery.toLowerCase().trim();
    return listings.filter(
      (item) =>
        (item.title && item.title.toLowerCase().includes(q)) ||
        (item.area_tag && item.area_tag.toLowerCase().includes(q)) ||
        (item.facilities && item.facilities.some((f) => f.toLowerCase().includes(q)))
    );
  }, [listings, searchQuery]);

  const lockedCount = Math.max(0, filteredListings.length - 3);

  const filterPills: { id: FilterChip; label: string; icon?: React.ElementType }[] = [
    { id: "all", label: "Semua Listing" },
    { id: "oper_kontrak", label: "Oper Kontrak", icon: ArrowLeftRight },
    { id: "under_700", label: "< Rp700rb" },
    { id: "km_dalam", label: "KM Dalam" },
    { id: "ac", label: "AC" },
    { id: "bebas_jam", label: "Bebas Jam Malam" },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-900">
      <Navbar
        cityName={selectedCity.name}
        isPaid={isPaid}
        expiresAt={expiresAt}
        onUnlockClick={() => setIsCheckoutOpen(true)}
        onRecoverClick={() => setIsRecoveryOpen(true)}
      />

      <main className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-28">
        {/* ── Top Live Banner ── */}
        <div className="mb-6 rounded-2xl bg-white border border-slate-200/80 p-3 sm:p-3.5 flex items-center justify-between gap-3 shadow-2xs">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-6 h-6 rounded-lg bg-emerald-100 flex items-center justify-center flex-shrink-0 text-emerald-700">
              <Zap className="w-3.5 h-3.5 fill-emerald-600 text-emerald-600" />
            </div>
            <p className="text-xs font-semibold text-slate-700 truncate">
              Pantauan real-time grup WA, Facebook, &amp; menfess kampus ({selectedCity.name})
            </p>
          </div>
          {!isPaid && (
            <button
              onClick={() => setIsRecoveryOpen(true)}
              className="flex-shrink-0 text-xs font-bold text-emerald-700 hover:text-emerald-800 hover:underline cursor-pointer"
            >
              Sudah Pernah Bayar? Pulihkan Akses
            </button>
          )}
        </div>

        {/* ── Hero Headline ── */}
        <div className="mb-6 max-w-2xl">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-100/80 text-emerald-800 text-xs font-bold mb-2.5">
            <span className="w-2 h-2 rounded-full bg-emerald-600 animate-ping" />
            <span>RADAR AKTIF • UPDATE TIAP 15 MENIT</span>
          </div>
          <h1 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold text-slate-900 tracking-tight leading-tight">
            Radar Kos Kosong &amp;{" "}
            <span className="text-emerald-600 underline decoration-emerald-300 underline-offset-4">
              Oper Kontrak Murah
            </span>
          </h1>
          <p className="text-xs sm:text-sm text-slate-600 mt-2 leading-relaxed">
            Dapatkan info kamar kosong tercepat dari grup warga dan mahasiswa sebelum didahului pemburu kos lain.
          </p>
        </div>

        {/* ── Search & Filter Card ── */}
        <div className="bg-white rounded-2xl shadow-xs border border-slate-200 p-4 sm:p-5 mb-8 space-y-3.5">
          {/* Top row: Campus selector & text search */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
            {/* Campus Dropdown */}
            <div className="md:col-span-5 relative">
              <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                Kota / Kampus
              </label>
              <div
                className="flex items-center justify-between bg-slate-50 hover:bg-slate-100 px-3.5 py-2.5 rounded-xl cursor-pointer transition-colors border border-slate-200"
                onClick={() => setIsCityOpen(!isCityOpen)}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <MapPin className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                  <span className="text-xs sm:text-sm font-bold text-slate-900 truncate">
                    {selectedCity.name} — {selectedCity.campuses}
                  </span>
                </div>
                {isCityOpen ? (
                  <ChevronUp className="w-4 h-4 text-slate-500 flex-shrink-0 ml-1" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-slate-500 flex-shrink-0 ml-1" />
                )}
              </div>

              {isCityOpen && (
                <div className="absolute top-full left-0 right-0 mt-1.5 bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xl z-30">
                  {SUPPORTED_CITIES.map((city) => (
                    <button
                      key={city.slug}
                      type="button"
                      onClick={() => {
                        setSelectedCity(city);
                        setIsCityOpen(false);
                      }}
                      className={`w-full text-left px-3.5 py-2.5 text-xs font-semibold transition-colors flex items-center justify-between cursor-pointer ${
                        city.slug === selectedCity.slug
                          ? "bg-emerald-50 text-emerald-700 font-bold"
                          : "text-slate-800 hover:bg-slate-50"
                      }`}
                    >
                      <span>
                        {city.name} ({city.campuses})
                      </span>
                      {city.slug === selectedCity.slug && (
                        <Check className="w-4 h-4 text-emerald-600" />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Keyword Search */}
            <div className="md:col-span-7">
              <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                Cari Area / Fasilitas
              </label>
              <div className="relative flex items-center">
                <Search className="w-4 h-4 absolute left-3.5 text-slate-400 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Contoh: Grendeng, Karangwangkal, AC, KM Dalam..."
                  className="w-full bg-slate-50 text-slate-900 placeholder:text-slate-400 text-xs sm:text-sm pl-10 pr-8 py-2.5 rounded-xl border border-slate-200 focus:outline-none focus:bg-white focus:ring-2 focus:ring-emerald-500/20 transition-all"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    className="absolute right-3 text-slate-400 hover:text-slate-700 cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Bottom row: Filter chips & counter */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pt-3 border-t border-slate-100">
            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
              {filterPills.map((pill) => {
                const isActive = activeFilter === pill.id;
                const Icon = pill.icon;
                return (
                  <button
                    key={pill.id}
                    type="button"
                    onClick={() => setActiveFilter(pill.id)}
                    className={`flex-shrink-0 px-3.5 py-1.5 rounded-full text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                      isActive
                        ? "bg-emerald-600 text-white shadow-xs"
                        : pill.id === "oper_kontrak"
                        ? "bg-amber-100 text-amber-900 hover:bg-amber-200/80"
                        : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                    }`}
                  >
                    {Icon && <Icon className="w-3.5 h-3.5" />}
                    <span>{pill.label}</span>
                    {isActive && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 whitespace-nowrap self-end sm:self-auto">
              <Zap className="w-3.5 h-3.5 text-amber-500 fill-amber-500" />
              <span>
                <strong className="text-emerald-700">{filteredListings.length} kamar</strong> terdeteksi di {selectedCity.name}
              </span>
            </div>
          </div>
        </div>

        {/* ── 3-COLUMN RESPONSIVE LISTINGS GRID ── */}
        <section>
          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[...Array(6)].map((_, i) => (
                <div
                  key={i}
                  className="bg-white rounded-2xl border border-slate-200 overflow-hidden animate-pulse flex flex-col"
                >
                  <div className="aspect-[16/10] bg-slate-100 w-full" />
                  <div className="p-4 space-y-2.5">
                    <div className="h-4 bg-slate-100 rounded w-1/3" />
                    <div className="h-5 bg-slate-100 rounded w-3/4" />
                    <div className="h-4 bg-slate-100 rounded w-1/2" />
                    <div className="h-10 bg-slate-50 rounded-xl mt-3" />
                  </div>
                </div>
              ))}
            </div>
          ) : filteredListings.length === 0 ? (
            <div className="bg-white rounded-2xl border border-dashed border-slate-300 p-12 text-center max-w-md mx-auto">
              <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center mx-auto text-slate-400">
                <Radar className="w-6 h-6" />
              </div>
              <h3 className="text-base font-bold text-slate-900 mt-3">
                Belum Ada Kamar dengan Kriteria Ini
              </h3>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                Coba ganti filter atau reset untuk melihat semua listing radar.
              </p>
              <button
                type="button"
                onClick={() => {
                  setActiveFilter("all");
                  setSearchQuery("");
                }}
                className="mt-4 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer"
              >
                Reset Semua Filter
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredListings.map((listing, index) => (
                <ListingCard
                  key={listing.id}
                  listing={listing}
                  isPaid={isPaid}
                  index={index}
                  onUnlockClick={() => setIsCheckoutOpen(true)}
                />
              ))}
            </div>
          )}
        </section>

        {/* ── Campus Radar Map Card ── */}
        {!loading && filteredListings.length > 0 && (
          <section className="mt-12">
            <div className="bg-white rounded-2xl p-5 sm:p-6 flex flex-col gap-3.5 border border-slate-200 shadow-2xs">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-emerald-50 text-emerald-700 flex items-center justify-center">
                    <Compass className="w-4 h-4" />
                  </div>
                  <h3 className="text-base font-bold text-slate-900">Peta Radar Sekitar Kampus</h3>
                </div>
                <span className="text-xs font-bold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200">
                  {selectedCity.name}
                </span>
              </div>
              <div
                className="w-full h-44 sm:h-52 rounded-xl bg-cover bg-center overflow-hidden relative shadow-inner"
                style={{
                  backgroundImage:
                    "url('https://lh3.googleusercontent.com/aida-public/AB6AXuAsUpcTbV3h8f0DayjLx5sdTjF9VZzPXqhyFr99XNP3gJ8zsdeLEn9j8IQ6T0X74exN0DyaQnVNoRnbsU-k8OkYK9LesgPFQNVmhTn13XMP_XFC9DaLmkQEY6s7wy9TT637HLP1k1glqowSRxrGpDYvuFzEiNxVUlF8UQwC9tVNKzQ56nvqRY_3rvTCi6uXYXJNWGPj7ZqmuhxGtYOiRZpwBC3D6l4GzTlLjy1L5sO2')",
                }}
              >
                <div className="absolute inset-0 bg-gradient-to-t from-slate-900/80 via-slate-900/20 to-transparent flex items-end p-3 sm:p-4">
                  <div className="flex items-center gap-2 text-white text-xs font-bold bg-slate-900/60 backdrop-blur-md px-3 py-1.5 rounded-full">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                    <span>{filteredListings.length} Titik Kamar Kosong Terpantau Aktif</span>
                  </div>
                </div>
              </div>
              <p className="text-xs text-slate-500">
                Radar mencakup radius 3km dari Grendeng, Karangwangkal, Bancarkembar, hingga Sumampir.
              </p>
            </div>
          </section>
        )}

        {/* ── Floating Sticky Bottom Bar (Constrained to max-w-lg) ── */}
        {!isPaid && lockedCount > 0 && (
          <div className="fixed bottom-4 sm:bottom-6 inset-x-0 z-40 px-4 pointer-events-none">
            <div className="pointer-events-auto max-w-lg mx-auto bg-slate-900/95 backdrop-blur-xl text-white p-3.5 rounded-2xl shadow-2xl flex items-center justify-between gap-3 border border-slate-800">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-9 h-9 rounded-xl bg-amber-500 flex items-center justify-center flex-shrink-0 text-slate-950">
                  <LockOpen className="w-4 h-4 stroke-[2.5]" />
                </div>
                <div className="flex flex-col min-w-0">
                  <p className="text-xs sm:text-sm font-bold truncate text-white">
                    {lockedCount} Kos Baru Terkunci
                  </p>
                  <p className="text-[11px] text-slate-300 truncate">
                    Buka seluruh kontak WA pemilik &amp; link asli
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsCheckoutOpen(true)}
                className="flex-shrink-0 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs sm:text-sm font-bold shadow-md active:scale-95 transition-transform cursor-pointer"
              >
                Buka Rp10rb
              </button>
            </div>
          </div>
        )}
      </main>

      {/* Checkout Modal */}
      <CheckoutModal
        isOpen={isCheckoutOpen}
        citySlug={selectedCity.slug}
        cityName={selectedCity.name}
        onClose={() => setIsCheckoutOpen(false)}
        onSuccess={() => {
          void reloadData();
        }}
      />

      {/* Recovery Modal */}
      <RecoveryModal
        isOpen={isRecoveryOpen}
        onClose={() => setIsRecoveryOpen(false)}
        onSuccess={() => {
          setIsRecoveryOpen(false);
          void reloadData();
        }}
      />
    </div>
  );
}
