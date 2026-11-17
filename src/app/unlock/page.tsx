"use client";

import { useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Zap,
  CheckCircle2,
  ChevronDown,
  ShieldCheck,
  AlertCircle,
  QrCode,
  Lock,
} from "lucide-react";
import { SUPPORTED_CITIES, type CityOption, formatRupiah } from "@/lib/format";
import { SUBSCRIPTION_PRICE } from "@/lib/constants";

function UnlockContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const cityParam = searchParams.get("city") || "purwokerto";

  const [selectedCity, setSelectedCity] = useState<CityOption>(
    SUPPORTED_CITIES.find((c) => c.slug === cityParam) || SUPPORTED_CITIES[0]
  );
  const [wa, setWa] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleCheckout(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);

    const cleanedWA = wa.trim();
    if (!cleanedWA) {
      setErrorMsg("Masukkan nomor WhatsApp aktif Anda.");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/payment/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          wa: cleanedWA,
          city_slug: selectedCity.slug,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (res.status === 409) {
          setErrorMsg("Anda sudah memiliki langganan aktif untuk kota ini! Mengalihkan ke feed...");
          setTimeout(() => router.push(`/?city=${selectedCity.slug}`), 1500);
        } else {
          setErrorMsg(data.error || "Gagal memproses pesanan. Coba lagi.");
        }
        setLoading(false);
        return;
      }

      const { snap_token, order_id } = data;

      if (typeof window !== "undefined" && window.snap) {
        window.snap.pay(snap_token, {
          onSuccess: async () => {
            try {
              const claimRes = await fetch("/api/auth/claim", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ order_id }),
              });
              if (claimRes.ok) {
                router.push(`/?city=${selectedCity.slug}&unlocked=1`);
              } else {
                router.push(`/?city=${selectedCity.slug}`);
              }
            } catch {
              router.push(`/?city=${selectedCity.slug}`);
            }
          },
          onPending: () => {
            setErrorMsg("Menunggu pembayaran... Silakan selesaikan QRIS Anda.");
            setLoading(false);
          },
          onError: () => {
            setErrorMsg("Pembayaran gagal atau dibatalkan.");
            setLoading(false);
          },
          onClose: () => {
            setLoading(false);
          },
        });
      } else {
        setErrorMsg("Midtrans SDK belum siap. Periksa koneksi internet.");
        setLoading(false);
      }
    } catch {
      setErrorMsg("Terjadi gangguan jaringan.");
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col justify-center items-center px-4 py-12 bg-slate-50 text-slate-900">
      <div className="w-full max-w-[440px]">
        {/* Back link */}
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-emerald-700 transition-colors mb-4"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Kembali ke Feed Radar Kos</span>
        </Link>

        <div className="relative rounded-2xl border border-slate-200 bg-white shadow-xl overflow-hidden">
          {/* Top accent bar */}
          <div className="h-1.5 w-full bg-gradient-to-r from-emerald-600 to-teal-500" />

          <div className="p-6 flex flex-col gap-4">
            {/* Header */}
            <div className="flex flex-col gap-1">
              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold self-start">
                <Zap className="w-3 h-3 fill-emerald-600 text-emerald-600" />
                <span>PAS AKSES PENUH 14 HARI</span>
              </div>
              <h1 className="text-xl font-extrabold text-slate-900 leading-snug tracking-tight">
                Buka Semua Kontak Pemilik &amp; Link Asli
              </h1>
              <p className="text-xs text-slate-600 leading-relaxed">
                Akses 14 hari tanpa batas untuk melihat nomor WhatsApp pemilik asli, info oper kontrak diskon, dan link grup asal di kota pilihanmu.
              </p>
            </div>

            {/* Benefits */}
            <div className="space-y-2">
              {[
                "Buka 100+ nomor WhatsApp pemilik asli & mahasiswa oper kontrak.",
                "Draf pesan WhatsApp negosiasi sopan sekali klik langsung ke pemilik.",
                "Tanpa mark up biaya calo / agen properti (hemat jutaan sewa tahunan).",
              ].map((benefit) => (
                <div
                  key={benefit}
                  className="flex items-start gap-2.5 p-2.5 rounded-xl bg-emerald-50/70 border border-emerald-100"
                >
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-slate-800 leading-snug font-medium">{benefit}</p>
                </div>
              ))}
            </div>

            {/* Form */}
            <form onSubmit={handleCheckout} className="space-y-3.5">
              {/* City selector */}
              <div>
                <label className="block text-xs font-semibold text-slate-900 mb-1">
                  Kota Target
                </label>
                <div className="relative">
                  <select
                    value={selectedCity.slug}
                    onChange={(e) => {
                      const found = SUPPORTED_CITIES.find((c) => c.slug === e.target.value);
                      if (found) setSelectedCity(found);
                    }}
                    className="w-full appearance-none rounded-xl bg-slate-50 border border-slate-200 px-3 py-2.5 pr-8 text-xs font-bold text-slate-900 focus:outline-none focus:bg-white focus:ring-2 focus:ring-emerald-500/20 transition-all cursor-pointer"
                  >
                    {SUPPORTED_CITIES.map((c) => (
                      <option key={c.slug} value={c.slug}>
                        {c.name} ({c.campuses})
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-3 text-slate-400 w-4 h-4" />
                </div>
              </div>

              {/* WA Input */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-semibold text-slate-900 flex items-center justify-between">
                  <span>Nomor WhatsApp Aktif</span>
                  <span className="text-[10px] text-emerald-700 font-medium">Untuk kirim tautan akses</span>
                </label>
                <div className="relative flex items-center h-11 bg-slate-50 rounded-xl px-3 gap-2 focus-within:bg-white focus-within:ring-2 focus-within:ring-emerald-500/20 transition-all border border-slate-200">
                  <div className="flex items-center gap-1 text-slate-600 flex-shrink-0 pr-2 border-r border-slate-200">
                    <span className="text-xs font-bold text-slate-900">🇮🇩 +62</span>
                  </div>
                  <input
                    type="tel"
                    required
                    inputMode="numeric"
                    pattern="[0-9]*"
                    placeholder="812-xxxx-xxxx"
                    value={wa}
                    onChange={(e) => setWa(e.target.value)}
                    className="w-full bg-transparent text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none font-mono"
                  />
                </div>
              </div>

              {/* Price card (flat Rp10.000) */}
              <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3 flex flex-col gap-1.5">
                <div className="flex items-baseline justify-between">
                  <span className="text-xs text-slate-600 font-medium">Total Pembayaran</span>
                  <div className="text-right">
                    <span className="text-lg font-extrabold text-emerald-700 tracking-tight">
                      {formatRupiah(SUBSCRIPTION_PRICE)}
                    </span>
                  </div>
                </div>
                <div className="flex items-center justify-between text-[11px] text-slate-500 border-t border-slate-200/60 pt-1.5">
                  <span>Sekali bayar untuk 14 hari, tanpa perpanjangan otomatis</span>
                </div>
                <div className="flex items-center gap-1.5 text-[10px] text-emerald-700 font-semibold">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>Garansi 100% uang kembali jika info kamar tidak valid</span>
                </div>
              </div>

              {errorMsg && (
                <div className="rounded-xl bg-red-50 border border-red-200 p-3 text-xs text-red-700 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>{errorMsg}</span>
                </div>
              )}

              {/* Pay button */}
              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 active:scale-[0.99] text-white font-bold rounded-xl shadow-sm flex items-center justify-center gap-2 text-sm transition-all cursor-pointer"
              >
                {loading ? (
                  <>
                    <span className="h-4 w-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                    <span>Menyiapkan QRIS...</span>
                  </>
                ) : (
                  <>
                    <QrCode className="w-4 h-4" />
                    <span>Bayar Instan via QRIS • Rp10.000</span>
                  </>
                )}
              </button>

              {/* Payment methods */}
              <div className="flex flex-col items-center gap-1.5 pt-1">
                <div className="flex items-center justify-center gap-1.5 flex-wrap">
                  {["QRIS", "GoPay", "DANA", "ShopeePay", "BCA", "Mandiri"].map((m) => (
                    <span
                      key={m}
                      className="px-2 py-0.5 rounded bg-slate-100 text-[10px] font-bold text-slate-600 border border-slate-200"
                    >
                      {m}
                    </span>
                  ))}
                </div>
                <div className="flex items-center gap-1.5 text-[10px] text-slate-400 mt-1">
                  <Lock className="w-3 h-3" />
                  <span>Enkripsi 256-bit • Pembayaran Aman & Instan via Midtrans</span>
                </div>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function UnlockPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-600 text-sm font-semibold">
          Memuat...
        </div>
      }
    >
      <UnlockContent />
    </Suspense>
  );
}
