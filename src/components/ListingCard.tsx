"use client";

import Image from "next/image";
import { useState } from "react";
import {
  ArrowLeftRight,
  Flame,
  User,
  Home,
  Camera,
  MapPin,
  BadgeCheck,
  MessageCircle,
  ExternalLink,
  Lock,
  KeyRound,
} from "lucide-react";
import { formatRelativeTime, formatRupiah } from "@/lib/format";
import { PlaceholderImage } from "./PlaceholderImage";
import { generateWALink, generateWAMessage } from "@/lib/radar/negotiator";

import type { PropertyType } from "@/lib/radar/types";

export interface ListingItem {
  id: string | number;
  title: string | null;
  price_monthly: number | null;
  property_type: PropertyType | null;
  area_tag: string | null;
  facilities: string[];
  image_urls: string[];
  ai_summary: string | null;
  posted_at: string;
  source_url?: string | null;
  contact_wa?: string | null;
  is_undervalued?: boolean;
  is_locked?: boolean;
}

interface ListingCardProps {
  listing: ListingItem;
  isPaid: boolean;
  onUnlockClick: () => void;
  /** index in feed — 0,1,2 are free-preview; 3+ are locked */
  index: number;
}

export function ListingCard({
  listing,
  isPaid,
  onUnlockClick,
  index,
}: ListingCardProps) {
  const [imageError, setImageError] = useState(false);
  const images = listing.image_urls || [];
  const hasValidImage = images.length > 0 && !imageError;
  const primaryImage = images[0];

  const isOper = listing.property_type === "oper_kontrak";
  const isUndervalued = !!listing.is_undervalued;

  // Locked if index >= 3 and not paid
  const isLocked = !isPaid && index >= 3;

  // Build badge for property type
  const typeBadge = isOper
    ? { label: "OPER KONTRAK", icon: ArrowLeftRight, bg: "bg-amber-500 text-amber-950" }
    : isUndervalued
    ? { label: "HARGA MIRING", icon: Flame, bg: "bg-emerald-600 text-white" }
    : listing.property_type === "kos_putri"
    ? { label: "KHUSUS PUTRI", icon: User, bg: "bg-rose-500 text-white" }
    : listing.property_type === "kos_putra"
    ? { label: "PUTRA", icon: User, bg: "bg-sky-600 text-white" }
    : { label: "KOS CAMPUR", icon: Home, bg: "bg-slate-700 text-white" };

  const TypeIcon = typeBadge.icon;

  // Right-side badge for oper_kontrak shows remaining months
  const rightBadgeText = isOper ? "Sisa Kontrak" : isUndervalued ? "Undervalued" : null;

  // WA link
  let waUrl = "#";
  if (isPaid && listing.contact_wa) {
    const waText = generateWAMessage({
      listing: {
        title: listing.title || "Kamar Kos",
        price_monthly: listing.price_monthly,
        property_type: listing.property_type,
        area_tag: listing.area_tag,
        facilities: listing.facilities || [],
        contact_wa: listing.contact_wa,
        is_undervalued: !!listing.is_undervalued,
        ai_summary: listing.ai_summary || "",
      },
      mode: "inquiry",
    });
    waUrl = generateWALink(listing.contact_wa, waText);
  }

  // Masked WA number (hide last 4 digits) for preview cards
  const maskedWa = listing.contact_wa
    ? listing.contact_wa.replace(/\d{4}$/, "XXXX")
    : "0812-XXXX-XXXX";

  const sourceLabel = isOper ? "Penyewa Sebelumnya:" : "Kontak Ibu Kos:";
  const verifiedLabel = isOper ? "Izin Host OK" : "Verified";

  return (
    <article className="bg-white rounded-2xl shadow-xs hover:shadow-md transition-shadow overflow-hidden flex flex-col border border-slate-200">
      {/* ── Photo ── */}
      <div className="relative aspect-[16/10] w-full overflow-hidden bg-slate-100">
        {hasValidImage ? (
          <Image
            src={primaryImage}
            alt={listing.title || "Foto kamar kos"}
            fill
            sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
            className="object-cover"
            onError={() => setImageError(true)}
            unoptimized
          />
        ) : (
          <PlaceholderImage propertyType={listing.property_type} />
        )}

        {/* Top overlay badges */}
        <div className="absolute top-3 inset-x-3 flex items-center justify-between gap-2">
          <span
            className={`px-2.5 py-1 rounded-full ${typeBadge.bg} text-[10px] font-bold tracking-wider shadow-sm flex items-center gap-1.5`}
          >
            <TypeIcon className="w-3 h-3 stroke-[2.5]" />
            <span>{typeBadge.label}</span>
          </span>

          <span className="px-2.5 py-1 rounded-full bg-white/95 backdrop-blur-md text-slate-800 text-[10px] font-semibold shadow-sm flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            <span>{formatRelativeTime(listing.posted_at)}</span>
          </span>
        </div>

        {/* Photo count */}
        {images.length > 1 && (
          <div className="absolute bottom-2.5 right-2.5 rounded-full bg-slate-900/70 backdrop-blur-md text-white px-2 py-0.5 text-[10px] font-medium flex items-center gap-1 pointer-events-none">
            <Camera className="w-3 h-3" />
            <span>{images.length}</span>
          </div>
        )}
      </div>

      {/* ── Card Body ── */}
      <div className="p-4 flex flex-col gap-2.5 flex-1">
        {/* Price row */}
        <div className="flex items-baseline justify-between gap-2">
          <div className="flex items-baseline gap-1">
            <span className="text-lg font-extrabold text-slate-900 tracking-tight">
              {formatRupiah(listing.price_monthly)}
            </span>
            <span className="text-xs font-medium text-slate-500">/bulan</span>
          </div>
          {rightBadgeText && (
            <span
              className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                isOper
                  ? "text-amber-900 bg-amber-100"
                  : "text-emerald-800 bg-emerald-100"
              }`}
            >
              {rightBadgeText}
            </span>
          )}
        </div>

        {/* Title */}
        <h2 className="text-sm font-bold text-slate-800 line-clamp-1 leading-snug">
          {listing.title || "Kamar Kos Siap Huni"}
        </h2>

        {/* Area */}
        <div className="flex items-center gap-1.5 text-slate-600 text-xs font-medium">
          <MapPin className="w-3.5 h-3.5 text-emerald-600 flex-shrink-0" />
          <span className="truncate">{listing.area_tag || "Sekitar Kampus"}</span>
        </div>

        {/* Facilities */}
        {listing.facilities && listing.facilities.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-0.5">
            {listing.facilities.slice(0, 3).map((fac, idx) => (
              <span
                key={idx}
                className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 text-[10px] font-medium capitalize"
              >
                {fac}
              </span>
            ))}
          </div>
        )}

        {/* ── ACTION FOOTER ── */}
        {isPaid ? (
          /* Subscribed: full contact + source */
          <div className="mt-auto pt-2">
            <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100 flex flex-col gap-2">
              <div className="flex items-center justify-between text-[11px] text-slate-600">
                <div className="flex items-center gap-1.5 min-w-0">
                  <BadgeCheck className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                  <span className="truncate">{sourceLabel}</span>
                  <span className="font-mono font-bold text-slate-900">{listing.contact_wa || "—"}</span>
                </div>
                <span className="text-emerald-700 font-bold text-[10px] flex-shrink-0">{verifiedLabel}</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <a
                  href={waUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="py-2 px-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 active:scale-95 transition-transform shadow-xs"
                >
                  <MessageCircle className="w-3.5 h-3.5" />
                  <span>Chat WA</span>
                </a>
                {listing.source_url ? (
                  <a
                    href={listing.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="py-2 px-3 bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-lg text-xs font-semibold flex items-center justify-center gap-1 active:scale-95 transition-transform"
                  >
                    <span>Sumber</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                ) : (
                  <div className="py-2 px-3 bg-slate-100 text-slate-400 rounded-lg text-xs font-semibold flex items-center justify-center">
                    <span>Sumber Publik</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        ) : !isLocked ? (
          /* Preview card (index 0–2): masked WA + unlock teaser */
          <div className="mt-auto pt-2">
            <div className="bg-slate-50 p-2.5 rounded-xl border border-slate-100 flex flex-col gap-2">
              <div className="flex items-center justify-between text-[11px] text-slate-600">
                <div className="flex items-center gap-1.5 min-w-0">
                  <BadgeCheck className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                  <span className="truncate">{sourceLabel}</span>
                  <span className="font-mono font-bold text-slate-900">{maskedWa}</span>
                </div>
                <span className="text-emerald-700 font-bold text-[10px] flex-shrink-0">{verifiedLabel}</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={onUnlockClick}
                  className="py-2 px-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 active:scale-95 transition-transform shadow-xs cursor-pointer"
                >
                  <MessageCircle className="w-3.5 h-3.5" />
                  <span>Chat WA</span>
                </button>
                <button
                  type="button"
                  onClick={onUnlockClick}
                  className="py-2 px-3 bg-white hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-lg text-xs font-semibold flex items-center justify-center gap-1 active:scale-95 transition-transform cursor-pointer"
                >
                  <span>Sumber</span>
                  <ExternalLink className="w-3 h-3" />
                </button>
              </div>
            </div>
          </div>
        ) : (
          /* LOCKED card (index 3+): frosted blur paywall */
          <div className="relative mt-auto pt-2">
            <div className="rounded-xl overflow-hidden border border-slate-200/80 p-3 flex flex-col items-center justify-center text-center bg-slate-50/70">
              {/* Blurred placeholder backdrop */}
              <div className="filter blur-xs select-none opacity-40 pointer-events-none w-full space-y-1.5">
                <div className="h-4 bg-slate-200 rounded w-3/4 mx-auto" />
                <div className="h-8 bg-emerald-100 rounded w-full" />
              </div>
              {/* Frosted glass overlay */}
              <div className="absolute inset-0 flex flex-col items-center justify-center p-3 bg-white/85 backdrop-blur-md">
                <div className="flex items-center gap-1.5 text-amber-900 text-xs font-bold mb-1.5">
                  <Lock className="w-3.5 h-3.5 text-amber-600" />
                  <span>Kontak &amp; Link Asli Terkunci</span>
                </div>
                <button
                  type="button"
                  onClick={onUnlockClick}
                  className="w-full py-2.5 px-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shadow-sm flex items-center justify-center gap-1.5 active:scale-95 transition-transform cursor-pointer"
                >
                  <KeyRound className="w-3.5 h-3.5" />
                  <span>Buka Kontak &amp; Link Asli (Rp10rb)</span>
                </button>
                <p className="text-[10px] text-slate-500 mt-1.5">
                  Akses langsung nomor WA &amp; menfess asli
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </article>
  );
}
