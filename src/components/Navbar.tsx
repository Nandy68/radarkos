"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Radar, BadgeCheck, Compass, Bookmark, ArrowLeftRight } from "lucide-react";

interface NavbarProps {
  cityName?: string;
  isPaid?: boolean;
  expiresAt?: string | null;
  onUnlockClick?: () => void;
  onRecoverClick?: () => void;
}

export function Navbar({
  cityName = "Purwokerto",
  isPaid = false,
  expiresAt,
  onUnlockClick,
  onRecoverClick,
}: NavbarProps) {
  const pathname = usePathname();

  const formattedExpiry = expiresAt
    ? new Date(expiresAt).toLocaleDateString("id-ID", {
        day: "numeric",
        month: "short",
      })
    : null;

  const mobileNavItems = [
    { href: "/", icon: Radar, label: "Radar" },
    { href: "/?filter=oper_kontrak", icon: ArrowLeftRight, label: "Oper" },
    { href: "/?tab=jelajah", icon: Compass, label: "Jelajah" },
    { href: "/?tab=tersimpan", icon: Bookmark, label: "Tersimpan" },
  ];

  return (
    <>
      {/* ── Top Header ── */}
      <header className="sticky top-0 inset-x-0 z-50 bg-white/90 backdrop-blur-md border-b border-slate-200/80 shadow-[0_1px_4px_rgba(0,0,0,0.03)]">
        <div className="max-w-6xl mx-auto h-16 px-4 sm:px-6 flex items-center justify-between gap-3">
          {/* Left: Logo & Radar Status */}
          <div className="flex items-center gap-3 sm:gap-4 min-w-0">
            <Link href="/" className="flex items-center gap-2.5 min-w-0 group">
              <div className="w-8 h-8 rounded-lg bg-emerald-600 flex items-center justify-center text-white shadow-sm group-hover:bg-emerald-700 transition-colors flex-shrink-0">
                <Radar className="w-4 h-4 stroke-[2.2]" />
              </div>
              <div className="flex flex-col min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-base font-extrabold text-slate-900 tracking-tight leading-none">
                    KosRadar
                  </span>
                  <span className="hidden sm:inline-block text-[10px] font-bold text-emerald-700 bg-emerald-100/70 px-1.5 py-0.5 rounded uppercase tracking-wider">
                    Live
                  </span>
                </div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="relative flex h-2 w-2 flex-shrink-0">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-600" />
                  </span>
                  <span className="text-[11px] font-semibold text-emerald-700 truncate tracking-wide">
                    Radar Aktif • Update tiap 15 mnt ({cityName})
                  </span>
                </div>
              </div>
            </Link>
          </div>

          {/* Right: Actions */}
          <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
            {/* Tombol Teks Pulihkan Akses */}
            {!isPaid && onRecoverClick && (
              <button
                type="button"
                onClick={onRecoverClick}
                className="text-xs font-semibold text-slate-600 hover:text-emerald-700 px-3 py-1.5 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
              >
                Pulihkan Akses
              </button>
            )}

            {isPaid ? (
              <div className="flex items-center gap-1.5 h-9 px-3 rounded-xl bg-emerald-50 text-emerald-700 text-xs font-bold border border-emerald-200">
                <BadgeCheck className="w-4 h-4 text-emerald-600" />
                <span className="whitespace-nowrap">
                  Aktif {formattedExpiry ? `s/d ${formattedExpiry}` : "14 Hari"}
                </span>
              </div>
            ) : (
              <button
                type="button"
                onClick={onUnlockClick}
                className="h-9 px-3.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 shadow-sm active:scale-95 transition-all cursor-pointer"
              >
                <Radar className="w-3.5 h-3.5" />
                <span className="whitespace-nowrap">Buka Semua Radar • Rp10.000</span>
              </button>
            )}
          </div>
        </div>
      </header>

      {/* ── Bottom Mobile Nav (Only on mobile) ── */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-50 bg-white/95 backdrop-blur-xl border-t border-slate-200 shadow-[0_-4px_16px_rgba(0,0,0,0.04)]">
        <div className="flex justify-around items-center h-14 px-2">
          {mobileNavItems.map((item) => {
            const isActive = pathname === item.href || (item.href === "/" && pathname === "/");
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex flex-col items-center justify-center gap-0.5 min-w-[48px] h-11 transition-colors ${
                  isActive
                    ? "text-emerald-600 font-bold"
                    : "text-slate-500 hover:text-slate-900"
                }`}
              >
                <Icon className="w-5 h-5 stroke-[2]" />
                <span className="text-[10px] font-semibold leading-none">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
