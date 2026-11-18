"use client";

import { useState } from "react";
import { SUBSCRIPTION_PRICE } from "@/lib/constants";
import { formatRupiah } from "@/lib/format";
import {
  X,
  Zap,
  CheckCircle2,
  ShieldCheck,
  AlertCircle,
  Lock,
} from "lucide-react";

declare global {
  interface Window {
    snap?: {
      pay: (
        token: string,
        callbacks: {
          onSuccess?: (result: Record<string, unknown>) => void;
          onPending?: (result: Record<string, unknown>) => void;
          onError?: (result: Record<string, unknown>) => void;
          onClose?: () => void;
        }
      ) => void;
    };
  }
}

interface CheckoutModalProps {
  isOpen: boolean;
  citySlug: string;
  cityName: string;
  onClose: () => void;
  onSuccess: () => void;
}

export function CheckoutModal({
  isOpen,
  citySlug,
  cityName,
  onClose,
  onSuccess,
}: CheckoutModalProps) {
  const [wa, setWa] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen) return null;

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
          city_slug: citySlug,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (res.status === 409) {
          setErrorMsg("Anda sudah memiliki langganan aktif! Silakan refresh halaman.");
        } else {
          setErrorMsg(data.error || "Gagal memproses pesanan. Coba lagi.");
        }
        setLoading(false);
        return;
      }

      const { snap_token, order_id } = data;

      // Tunggu hingga snap.js siap jika masih loading
      let snapInstance = typeof window !== "undefined" ? window.snap : undefined;
      if (!snapInstance) {
        for (let i = 0; i < 10; i++) {
          await new Promise((r) => setTimeout(r, 200));
          if (typeof window !== "undefined" && window.snap) {
            snapInstance = window.snap;
            break;
          }
        }
      }

      if (snapInstance) {
        snapInstance.pay(snap_token, {
          onSuccess: async () => {
            try {
              const claimRes = await fetch("/api/auth/claim", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ order_id }),
              });
              if (claimRes.ok) {
                onSuccess();
                onClose();
              } else {
                window.location.reload();
              }
            } catch {
              window.location.reload();
            }
          },
          onPending: () => {
            setErrorMsg("Menunggu pembayaran... Silakan selesaikan di aplikasi Anda.");
            setLoading(false);
          },
          onError: () => {
            setErrorMsg("Pembayaran dibatalkan atau gagal diproses.");
            setLoading(false);
          },
          onClose: () => {
            setLoading(false);
          },
        });
      } else {
        // Fallback: Jika popup snap.js terblokir adblock/browser, alihkan langsung ke halaman bayar Midtrans
        const redirectUrl = `https://app.sandbox.midtrans.com/snap/v2/vtweb/${snap_token}`;
        window.location.href = redirectUrl;
      }
    } catch {
      setErrorMsg("Terjadi gangguan koneksi. Silakan coba lagi.");
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="relative my-auto w-full max-w-[420px] rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden">
        {/* Top accent bar */}
        <div className="h-1.5 w-full bg-gradient-to-r from-emerald-600 to-teal-500" />

        {/* Close btn */}
        <button
          aria-label="Tutup Modal"
          onClick={onClose}
          className="absolute top-3.5 right-3.5 p-1.5 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors flex items-center justify-center z-10 cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="p-6 pt-5 flex flex-col gap-4">
          {/* Header */}
          <div className="flex flex-col gap-1.5">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold self-start">
              <Zap className="w-3 h-3 fill-emerald-600 text-emerald-600" />
              <span>PAS AKSES PENUH 14 HARI</span>
            </div>
            <h2 className="text-xl font-extrabold text-slate-900 leading-snug tracking-tight">
              Buka Semua Kontak Pemilik &amp; Link Asli
            </h2>
            <p className="text-xs text-slate-600 leading-relaxed">
              Akses 14 hari tanpa batas untuk melihat nomor WhatsApp pemilik asli, info oper kontrak diskon, dan link grup asal di {cityName}.
            </p>
          </div>

          {/* Benefits */}
          <div className="space-y-2">
            {[
              "Buka 100+ nomor WhatsApp pemilik asli & penyewa oper kontrak.",
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
          <form onSubmit={handleCheckout} className="flex flex-col gap-3.5">
            {/* WA input */}
            <div className="flex flex-col gap-1.5">
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

            {/* Submit button */}
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
                  <Lock className="w-4 h-4" />
                  <span>Bayar QRIS Instan • {formatRupiah(SUBSCRIPTION_PRICE)}</span>
                </>
              )}
            </button>

            {/* Payment security info */}
            <div className="flex flex-col items-center gap-1 pt-1">
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
              <p className="text-[10px] text-slate-400 mt-1">
                🔒 Pembayaran aman diverifikasi instan via Midtrans
              </p>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
