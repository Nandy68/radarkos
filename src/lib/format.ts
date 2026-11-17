/**
 * Formatting and display helpers for KosRadar.
 */

export function formatRupiah(amount: number | null | undefined): string {
  if (amount == null) return "Nego / Hubungi";
  return `Rp${amount.toLocaleString("id-ID")}`;
}

export function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diffSec < 60) return "Baru saja";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `Baru ${diffMin} menit lalu`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} jam lalu`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay === 1) return "Kemarin";
  if (diffDay < 14) return `${diffDay} hari lalu`;
  return date.toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
  });
}

export interface CityOption {
  slug: string;
  name: string;
  campuses: string;
}

export const SUPPORTED_CITIES: CityOption[] = [
  { slug: "purwokerto", name: "Purwokerto", campuses: "Unsoed, UMP, Telkom" },
  { slug: "yogyakarta", name: "Yogyakarta", campuses: "UGM, UNY, UPN, UII" },
  { slug: "malang", name: "Malang", campuses: "UB, UM, UIN, UMM" },
  { slug: "bandung", name: "Bandung", campuses: "ITB, Unpad, Telkom" },
  { slug: "semarang", name: "Semarang", campuses: "Undip, Unnes, Udinus" },
  { slug: "depok", name: "Depok", campuses: "UI, Gunadarma, Polimedia" },
];
