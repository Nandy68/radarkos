"use client";

import { useState } from "react";
import Image from "next/image";
import {
  X,
  MapPin,
  BadgeCheck,
  MessageCircle,
  ExternalLink,
  ShieldCheck,
  ChevronLeft,
  ChevronRight,
  Flame,
  ArrowLeftRight,
  User,
  Home,
  CheckCircle2,
  Lock,
  TrendingDown,
  AlertTriangle,
} from "lucide-react";
import { formatRupiah, formatRelativeTime } from "@/lib/format";
import { generateWALink, generateWAMessage } from "@/lib/radar/negotiator";
import type { ListingItem } from "./ListingCard";

interface ListingDetailModalProps {
  listing: ListingItem | null;
  isOpen: boolean;
  isPaid: boolean;
  onClose: () => void;
  onUnlockClick: () => void;
}

export function ListingDetailModal({
  listing,
  isOpen,
  isPaid,
  onClose,
  onUnlockClick,
}: ListingDetailModalProps) {
  const [activePhotoIdx, setActivePhotoIdx] = useState(0);

  if (!isOpen || !listing) return null;

  const images = listing.image_urls || [];
  const hasImages = images.length > 0;
  const currentPhoto = images[activePhotoIdx] || images[0];

  const isOper = listing.property_type === "oper_kontrak";
  const isUndervalued = !!listing.is_undervalued;
  const discountPct =
    typeof listing.discount_pct === "number" && listing.discount_pct > 0
      ? Math.round(listing.discount_pct)
      : null;
  const marketValue =
    typeof listing.market_value === "number" && listing.market_value > 0
      ? listing.market_value
      : null;
  const confidencePct =
    typeof listing.deal_confidence === "number"
      ? Math.round(listing.deal_confidence * 100)
      : null;
  const dealReasons = listing.deal_reasons ?? [];
  const riskFlags = listing.risk_flags ?? [];

  // Masked WA
  const isUnlocked = isPaid || listing.contact_wa?.endsWith("****") === false;
  const rawWa = listing.contact_wa || "";
  const isMasked = rawWa.includes("*");

  let waUrl = "#";
  if (isUnlocked && !isMasked && rawWa) {
    const waText = generateWAMessage({
      listing: {
        title: listing.title || "Kamar Kos",
        price_monthly: listing.price_monthly,
        property_type: listing.property_type,
        area_tag: listing.area_tag,
        facilities: listing.facilities || [],
        contact_wa: rawWa,
        is_undervalued: isUndervalued,
        ai_summary: listing.ai_summary || "",
      },
      mode: isOper ? "inquiry" : "inquiry",
    });
    waUrl = generateWALink(rawWa, waText);
  }

  const nextPhoto = () => {
    setActivePhotoIdx((prev) => (prev + 1) % images.length);
  };

  const prevPhoto = () => {
    setActivePhotoIdx((prev) => (prev - 1 + images.length) % images.length);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 overflow-y-auto bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="relative my-auto w-full max-w-2xl rounded-2xl bg-white shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header bar */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100 bg-white">
          <div className="flex items-center gap-2">
            <span
              className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-wider flex items-center gap-1 ${
                isOper
                  ? "bg-amber-100 text-amber-900"
                  : isUndervalued
                  ? "bg-emerald-100 text-emerald-800"
                  : "bg-slate-100 text-slate-700"
              }`}
            >
              {isOper ? (
                <>
                  <ArrowLeftRight className="w-3 h-3 stroke-[2.5]" />
                  <span>OPER KONTRAK</span>
                </>
              ) : isUndervalued ? (
                <>
                  <Flame className="w-3 h-3 text-emerald-600 fill-emerald-600" />
                  <span>HARGA MIRING</span>
                </>
              ) : (
                <>
                  <Home className="w-3 h-3" />
                  <span>KOS TERVERIFIKASI</span>
                </>
              )}
            </span>
            <span className="text-xs text-slate-500 font-medium">
              Dipantau {formatRelativeTime(listing.posted_at)}
            </span>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-full text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto p-5 sm:p-6 space-y-5">
          {/* Photo Gallery */}
          {hasImages && (
            <div className="space-y-2">
              <div className="relative aspect-[16/10] w-full rounded-xl overflow-hidden bg-slate-100 border border-slate-200">
                <Image
                  src={currentPhoto}
                  alt={listing.title || "Foto Kos"}
                  fill
                  className="object-cover"
                  unoptimized
                />

                {images.length > 1 && (
                  <>
                    <button
                      type="button"
                      onClick={prevPhoto}
                      className="absolute left-2.5 top-1/2 -translate-y-1/2 p-2 rounded-full bg-slate-900/60 hover:bg-slate-900 text-white transition-colors cursor-pointer"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={nextPhoto}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 p-2 rounded-full bg-slate-900/60 hover:bg-slate-900 text-white transition-colors cursor-pointer"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                    <div className="absolute bottom-2.5 right-2.5 px-2.5 py-1 rounded-full bg-slate-900/70 text-white text-[10px] font-mono">
                      {activePhotoIdx + 1} / {images.length} Foto
                    </div>
                  </>
                )}
              </div>

              {/* Thumbnails */}
              {images.length > 1 && (
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {images.map((img, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setActivePhotoIdx(i)}
                      className={`relative w-16 h-12 rounded-lg overflow-hidden flex-shrink-0 border-2 transition-all cursor-pointer ${
                        activePhotoIdx === i
                          ? "border-emerald-600 scale-95"
                          : "border-transparent opacity-70 hover:opacity-100"
                      }`}
                    >
                      <Image
                        src={img}
                        alt="Thumbnail"
                        fill
                        className="object-cover"
                        unoptimized
                      />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Pricing & Title */}
          <div className="space-y-2">
            <div className="flex items-baseline justify-between flex-wrap gap-2">
              <div className="flex items-baseline gap-1.5">
                <span className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
                  {formatRupiah(listing.price_monthly)}
                </span>
                <span className="text-sm text-slate-500 font-medium">/bulan</span>
              </div>
              {discountPct != null && marketValue != null && (
                <span className="px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 text-xs font-bold border border-emerald-200">
                  {discountPct}% di bawah pasar ({formatRupiah(marketValue)})
                </span>
              )}
            </div>

            <h1 className="text-lg sm:text-xl font-bold text-slate-900 leading-snug">
              {listing.title}
            </h1>

            <div className="flex items-center gap-1.5 text-xs text-slate-600 font-medium">
              <MapPin className="w-4 h-4 text-emerald-600 flex-shrink-0" />
              <span>{listing.area_tag || "Area Sekitar Kampus"}</span>
            </div>
          </div>

          {/* AI / Verifier Intelligence Notes */}
          {listing.ai_summary && (
            <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 space-y-1.5">
              <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                <span>Catatan Tim Verifikasi Radar</span>
              </h3>
              <p className="text-xs text-slate-700 leading-relaxed">
                {listing.ai_summary}
              </p>
            </div>
          )}

          {/* Deal engine analysis */}
          {(marketValue != null || dealReasons.length > 0) && (
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs font-bold text-emerald-900 uppercase tracking-wider flex items-center gap-1.5">
                  <TrendingDown className="w-4 h-4 text-emerald-700" />
                  <span>Analisis Harga Pasar</span>
                </h3>
                {confidencePct != null && (
                  <span className="text-[10px] font-bold text-emerald-800 bg-white/80 border border-emerald-200 rounded-full px-2 py-0.5">
                    Keyakinan {confidencePct}%
                  </span>
                )}
              </div>

              {marketValue != null && (
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-lg bg-white/80 border border-emerald-100 p-2.5">
                    <p className="text-[10px] font-semibold text-slate-500 uppercase">Nilai pasar area</p>
                    <p className="font-extrabold text-slate-900 mt-0.5">{formatRupiah(marketValue)}</p>
                  </div>
                  <div className="rounded-lg bg-white/80 border border-emerald-100 p-2.5">
                    <p className="text-[10px] font-semibold text-slate-500 uppercase">Selisih harga</p>
                    <p className="font-extrabold text-emerald-700 mt-0.5">
                      {discountPct != null ? `${discountPct}% lebih murah` : "Sesuai pasar"}
                    </p>
                  </div>
                </div>
              )}

              {dealReasons.length > 0 && (
                <ul className="space-y-1">
                  {dealReasons.slice(0, 4).map((reason, index) => (
                    <li key={index} className="flex items-start gap-1.5 text-[11px] text-slate-700">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0 mt-0.5" />
                      <span>{reason}</span>
                    </li>
                  ))}
                </ul>
              )}

              {riskFlags.length > 0 && (
                <div className="flex items-start gap-1.5 rounded-lg bg-amber-50 border border-amber-200 p-2.5 text-[11px] text-amber-900">
                  <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                  <span>
                    Perlu verifikasi: {riskFlags.map((flag) => flag.label).join("; ")}.
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Facilities */}
          {listing.facilities && listing.facilities.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                Fasilitas Kamar &amp; Bersama
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {listing.facilities.map((fac, idx) => (
                  <div
                    key={idx}
                    className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-50 border border-slate-100 text-xs font-medium text-slate-700"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
                    <span className="truncate capitalize">{fac}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Landlord Contact & Takeover Action Card */}
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50/50 p-4 sm:p-5 space-y-3.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-full bg-emerald-600 text-white flex items-center justify-center font-bold text-sm">
                  <User className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-900">
                    {isOper ? "Penyewa Oper Kontrak (Mahasiswa)" : "Ibu/Bapak Kos (Pemilik Langsung)"}
                  </p>
                  <p className="text-[11px] text-emerald-700 font-semibold flex items-center gap-1">
                    <BadgeCheck className="w-3.5 h-3.5" />
                    <span>Terverifikasi • Tanpa Perantara / Calo</span>
                  </p>
                </div>
              </div>
            </div>

            {/* WA number state */}
            {isUnlocked && !isMasked ? (
              <div className="space-y-3">
                <div className="bg-white rounded-xl p-3 border border-emerald-100 flex items-center justify-between">
                  <div>
                    <p className="text-[10px] text-slate-500 font-medium">Nomor WhatsApp Resmi:</p>
                    <p className="font-mono font-bold text-slate-900 text-base">{rawWa}</p>
                  </div>
                  <span className="text-xs font-bold text-emerald-700 bg-emerald-50 px-2 py-1 rounded-md">
                    Aktif
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <a
                    href={waUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all shadow-sm"
                  >
                    <MessageCircle className="w-4 h-4" />
                    <span>Chat WA dengan Template Sopan</span>
                  </a>

                  {listing.source_url ? (
                    <a
                      href={listing.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-full py-3 px-4 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all"
                    >
                      <span>Lihat Postingan Sumber Asli</span>
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  ) : null}
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="bg-white rounded-xl p-3 border border-slate-200 flex items-center justify-between">
                  <div>
                    <p className="text-[10px] text-slate-500 font-medium">Nomor WhatsApp Terlindungi:</p>
                    <p className="font-mono font-bold text-slate-900 text-base">
                      {listing.contact_wa || "0812-XXXX-XXXX"}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 text-[11px] text-amber-800 font-bold bg-amber-50 px-2 py-1 rounded-md border border-amber-200">
                    <Lock className="w-3 h-3" />
                    <span>Akses Terkunci</span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onUnlockClick();
                  }}
                  className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs sm:text-sm font-bold flex items-center justify-center gap-2 transition-all shadow-md cursor-pointer active:scale-95"
                >
                  <Lock className="w-4 h-4" />
                  <span>Buka Kontak Pemilik &amp; Link Asli (Rp10.000 / 14 Hari)</span>
                </button>
                <p className="text-[10px] text-center text-slate-500">
                  ⚡ Sekali bayar untuk buka 100+ kontak kos &amp; oper kontrak selama 14 hari penuh.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
