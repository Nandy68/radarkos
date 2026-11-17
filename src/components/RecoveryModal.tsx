"use client";

import { useState } from "react";
import {
  X,
  KeyRound,
  CheckCircle2,
  AlertCircle,
  Send,
  Unlock,
} from "lucide-react";

interface RecoveryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function RecoveryModal({
  isOpen,
  onClose,
  onSuccess,
}: RecoveryModalProps) {
  const [wa, setWa] = useState("");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [claimUrl, setClaimUrl] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  if (!isOpen) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    setClaimUrl(null);
    setSuccessMsg(null);

    const cleanedWA = wa.trim();
    if (!cleanedWA) {
      setErrorMsg("Masukkan nomor WhatsApp yang pernah Anda gunakan.");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/auth/recover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wa: cleanedWA }),
      });

      const data = await res.json();

      if (!res.ok) {
        setErrorMsg(data.error || "Gagal memproses pemulihan akses.");
        setLoading(false);
        return;
      }

      setSuccessMsg(data.message || "Tautan akses dikirim ke WhatsApp Anda.");
      if (data.claim_url) {
        setClaimUrl(data.claim_url);
      }
    } catch {
      setErrorMsg("Terjadi gangguan koneksi. Silakan coba lagi.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="relative my-auto w-full max-w-[400px] rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden">
        {/* Top accent bar */}
        <div className="h-1.5 w-full bg-gradient-to-r from-emerald-600 to-teal-500" />

        {/* Close button */}
        <button
          aria-label="Tutup Modal"
          onClick={() => {
            setErrorMsg(null);
            setClaimUrl(null);
            setSuccessMsg(null);
            onClose();
          }}
          className="absolute top-3.5 right-3.5 p-1.5 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors flex items-center justify-center z-10 cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="p-6 pt-5 flex flex-col gap-4">
          {/* Header */}
          <div className="flex flex-col gap-1.5">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold self-start">
              <KeyRound className="w-3 h-3 text-emerald-700" />
              <span>PULIHKAN AKSES</span>
            </div>
            <h2 className="text-lg font-extrabold text-slate-900 tracking-tight">
              Akses di Perangkat Baru?
            </h2>
            <p className="text-xs text-slate-600 leading-relaxed">
              Masukkan nomor WhatsApp yang pernah Anda pakai untuk membayar. Sistem akan langsung memverifikasi langganan aktif Anda.
            </p>
          </div>

          {!claimUrl ? (
            <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-slate-900">
                  Nomor WhatsApp Terdaftar
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

              {errorMsg && (
                <div className="rounded-xl bg-red-50 border border-red-200 p-3 text-xs text-red-700 flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  <span>{errorMsg}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 px-4 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-2 transition-all shadow-sm cursor-pointer"
              >
                {loading ? (
                  <>
                    <span className="h-3.5 w-3.5 rounded-full border-2 border-white border-t-transparent animate-spin" />
                    <span>Memeriksa langganan...</span>
                  </>
                ) : (
                  <>
                    <span>Kirim Tautan Akses</span>
                    <Send className="w-3.5 h-3.5" />
                  </>
                )}
              </button>
            </form>
          ) : (
            <div className="flex flex-col gap-3.5 py-1">
              <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-3 flex flex-col gap-2">
                <div className="flex items-center gap-1.5 text-emerald-800 text-xs font-bold">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span>Langganan Aktif Ditemukan!</span>
                </div>
                <p className="text-xs text-slate-700 leading-snug">
                  {successMsg}
                </p>
              </div>

              <div className="flex flex-col gap-1.5 pt-1">
                <span className="text-[11px] font-semibold text-slate-600">
                  Tautan Pemulihan Instan (Klik untuk langsung aktif):
                </span>
                <a
                  href={claimUrl}
                  onClick={() => {
                    setTimeout(() => onSuccess(), 500);
                  }}
                  className="w-full py-2.5 px-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all shadow-sm text-center"
                >
                  <Unlock className="w-4 h-4" />
                  <span>Buka Radar Sekarang di Perangkat Ini</span>
                </a>
              </div>
            </div>
          )}

          <p className="text-[10px] text-center text-slate-400 pt-1">
            🔒 Tanpa password. Akses diverifikasi otomatis menggunakan nomor WhatsApp Anda.
          </p>
        </div>
      </div>
    </div>
  );
}
