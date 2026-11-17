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
  Check,
  LockOpen,
  Radar,
  ShieldCheck,
  TrendingDown,
  Building2,
  CheckCircle2,
  HelpCircle,
} from "lucide-react";
import { Navbar } from "@/components/Navbar";
import { ListingCard, type ListingItem } from "@/components/ListingCard";
import { ListingDetailModal } from "@/components/ListingDetailModal";
import { CheckoutModal } from "@/components/CheckoutModal";
import { RecoveryModal } from "@/components/RecoveryModal";
import { SUPPORTED_CITIES, type CityOption } from "@/lib/format";
import { CITY_MARKET_STATS } from "@/lib/data/listings-db";

type FilterChip = "all" | "oper_kontrak" | "under_700" | "km_dalam" | "ac" | "bebas_jam";

export default function HomePage() {
  const [selectedCity, setSelectedCity] = useState<CityOption>(SUPPORTED_CITIES[0]);
  const [activeFilter, setActiveFilter] = useState<FilterChip>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [listings, setListings] = useState<ListingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [isPaid, setIsPaid] = useState(false);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [feedMode, setFeedMode] = useState<"deals" | "fallback">("fallback");

  // Modals state
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [isRecoveryOpen, setIsRecoveryOpen] = useState(false);
  const [isCityOpen, setIsCityOpen] = useState(false);
  const [selectedListingForModal, setSelectedListingForModal] = useState<ListingItem | null>(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);

  const marketStats =
    CITY_MARKET_STATS[selectedCity.slug] || CITY_MARKET_STATS.purwokerto;

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
        setFeedMode(listData.feed_mode === "deals" ? "deals" : "fallback");
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
          setFeedMode(listData.feed_mode === "deals" ? "deals" : "fallback");
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
    return () => {
      active = false;
    };
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
    { id: "all", label: "Semua Kamar" },
    { id: "oper_kontrak", label: "Oper Kontrak (Diskon)", icon: ArrowLeftRight },
    { id: "under_700", label: "Harga < Rp700rb" },
    { id: "km_dalam", label: "KM Dalam" },
    { id: "ac", label: "AC" },
    { id: "bebas_jam", label: "Bebas Jam Malam" },
  ];

  const handleCardClick = (listing: ListingItem) => {
    setSelectedListingForModal(listing);
    setIsDetailModalOpen(true);
  };

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
        {/* ── Top Announcement & Trust Bar ── */}
        <div className="mb-6 rounded-2xl bg-white border border-slate-200/80 p-3 sm:p-3.5 flex items-center justify-between gap-3 shadow-2xs">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-6 h-6 rounded-lg bg-emerald-100 flex items-center justify-center flex-shrink-0 text-emerald-700">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
            </div>
            <p className="text-xs font-semibold text-slate-700 truncate">
              Katalog Info Kamar Langsung Pemilik • Tanpa Biaya Makelar / Calo ({selectedCity.name})
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
        <div className="mb-6 max-w-3xl">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 text-xs font-bold mb-3 border border-emerald-200">
            <span className="w-2 h-2 rounded-full bg-emerald-600 animate-pulse" />
            <span>UPDATE TERBARU HARI INI • KOTA {selectedCity.name.toUpperCase()}</span>
          </div>
          <h1 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold text-slate-900 tracking-tight leading-tight">
            Pantau Kos Kosong &amp;{" "}
            <span className="text-emerald-600 underline decoration-emerald-300 underline-offset-4">
              Oper Kontrak Murah
            </span>{" "}
            Sebelum Diambil Orang
          </h1>
          <p className="text-xs sm:text-sm text-slate-600 mt-2.5 leading-relaxed max-w-2xl">
            Info kamar cepat dari grup warga dan forum mahasiswa di sekitar {selectedCity.campuses}. Nomor WhatsApp asli pemilik langsung tersedia tanpa perantara.
          </p>
        </div>

        {/* ── Search & Filter Card ── */}
        <div className="bg-white rounded-2xl shadow-xs border border-slate-200 p-4 sm:p-5 mb-8 space-y-4">
          {/* Top row: Campus selector & text search */}
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
            {/* Campus Dropdown */}
            <div className="md:col-span-5 relative">
              <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                Pilih Kota &amp; Kampus
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
                <div className="absolute top-full left-0 right-0 mt-1.5 bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xl z-30 divide-y divide-slate-100">
                  {SUPPORTED_CITIES.map((city) => (
                    <button
                      key={city.slug}
                      type="button"
                      onClick={() => {
                        setSelectedCity(city);
                        setIsCityOpen(false);
                      }}
                      className={`w-full text-left px-3.5 py-3 text-xs font-semibold transition-colors flex items-center justify-between cursor-pointer ${
                        city.slug === selectedCity.slug
                          ? "bg-emerald-50 text-emerald-700 font-bold"
                          : "text-slate-800 hover:bg-slate-50"
                      }`}
                    >
                      <div>
                        <p className="font-bold">{city.name}</p>
                        <p className="text-[10px] text-slate-500 mt-0.5">{city.campuses}</p>
                      </div>
                      {city.slug === selectedCity.slug && (
                        <Check className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Keyword Search */}
            <div className="md:col-span-7">
              <label className="block text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-1">
                Cari Lokasi / Jalan / Fasilitas
              </label>
              <div className="relative flex items-center">
                <Search className="w-4 h-4 absolute left-3.5 text-slate-400 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={`Cari misal: ${marketStats.coverageAreas[0]}, AC, KM Dalam...`}
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
                <strong className="text-emerald-700">
                  {feedMode === "deals"
                    ? `${filteredListings.length} deal di bawah pasar`
                    : `${filteredListings.length} listing radar`}
                </strong>{" "}
                di {selectedCity.name}
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
                Coba ganti filter atau pilih kota lain untuk melihat listing kamar kosong yang tersedia.
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
                  onCardClick={handleCardClick}
                />
              ))}
            </div>
          )}
        </section>

        {/* ── Realistic Market Intelligence & Radius Coverage ── */}
        {!loading && filteredListings.length > 0 && (
          <section className="mt-12 space-y-6">
            <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-2xs space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-4">
                <div>
                  <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-emerald-600" />
                    <span>Data Wilayah &amp; Riset Harga: {selectedCity.name}</span>
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Ringkasan harga pasaran rata-rata kamar sewa di sekitar kampus {selectedCity.campuses}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-emerald-800 bg-emerald-100 px-3 py-1 rounded-full border border-emerald-200">
                    {marketStats.operSavings}
                  </span>
                </div>
              </div>

              {/* Stats badges */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-100 space-y-1">
                  <p className="text-[11px] text-slate-500 font-medium">Estimasi Rata-rata Sewa Normal:</p>
                  <p className="text-base font-extrabold text-slate-900">{marketStats.avgPrice}</p>
                </div>
                <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-100 space-y-1">
                  <p className="text-[11px] text-slate-500 font-medium">Potensi Hemat Oper Kontrak:</p>
                  <p className="text-base font-extrabold text-emerald-700 flex items-center gap-1">
                    <TrendingDown className="w-4 h-4" />
                    <span>{marketStats.operSavings}</span>
                  </p>
                </div>
                <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-100 space-y-1">
                  <p className="text-[11px] text-slate-500 font-medium">Status Verifikasi:</p>
                  <p className="text-xs font-bold text-slate-800 flex items-center gap-1 pt-0.5">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    <span>Pemilik Langsung (Tanpa Calo)</span>
                  </p>
                </div>
              </div>

              {/* Covered areas chips */}
              <div className="space-y-2 pt-1">
                <p className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                  Wilayah Terpantau di {selectedCity.name}:
                </p>
                <div className="flex flex-wrap gap-2">
                  {marketStats.coverageAreas.map((area, idx) => (
                    <span
                      key={idx}
                      className="px-3 py-1 rounded-lg bg-emerald-50 text-emerald-800 text-xs font-semibold border border-emerald-200/60"
                    >
                      {area}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* Why KosRadar is different / commercial trust */}
            <div className="bg-slate-900 text-white rounded-2xl p-6 sm:p-8 space-y-4">
              <div className="flex items-center gap-2 text-emerald-400 text-xs font-bold uppercase tracking-wider">
                <HelpCircle className="w-4 h-4" />
                <span>Kenapa Kos di KosRadar Jauh Lebih Murah?</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-1 text-xs leading-relaxed text-slate-300">
                <div className="space-y-1.5">
                  <p className="font-bold text-white text-sm">1. Tanpa Mark-Up Calo &amp; Agen</p>
                  <p>
                    Aplikasi properti besar biasanya memotong komisi 20% - 30% dari pemilik kos. KosRadar menyajikan info mentah langsung dari pemilik asli sehingga harga tetap murni dan jujur.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <p className="font-bold text-white text-sm">2. Spesialis Oper Kontrak Murah</p>
                  <p>
                    Banyak mahasiswa yang lulus skripsi lebih awal atau pindah magang rela melepas sisa kontrak kosnya dengan diskon 30% - 50%. KosRadar mendeteksi postingan ini seketika.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <p className="font-bold text-white text-sm">3. Kontak WhatsApp Langsung</p>
                  <p>
                    Anda langsung menghubungi nomor WhatsApp pemilik tanpa perlu chat tertunda di aplikasi. Disertai draf pesan sopan sekali klik untuk memperbesar peluang dapat kamar.
                  </p>
                </div>
              </div>
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
                    {lockedCount} Kos Terverifikasi Terkunci
                  </p>
                  <p className="text-[11px] text-slate-300 truncate">
                    Buka seluruh kontak WA pemilik &amp; postingan asli
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

      {/* Listing Detail Modal */}
      <ListingDetailModal
        listing={selectedListingForModal}
        isOpen={isDetailModalOpen}
        isPaid={isPaid}
        onClose={() => {
          setIsDetailModalOpen(false);
          setSelectedListingForModal(null);
        }}
        onUnlockClick={() => {
          setIsDetailModalOpen(false);
          setIsCheckoutOpen(true);
        }}
      />

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
