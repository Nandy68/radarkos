/**
 * Registry target scraping + keyword pencarian.
 * Sumber kebenaran target; state runtime ada di tabel `sources`.
 */

export type SearchPlatform =
  | "twitter_x"
  | "facebook"
  | "instagram"
  | "web_menfess";

export interface CityConfig {
  name: string;
  areas: string[];
  campuses: string[];
}

export const KEYWORDS = [
  "kos",
  "kost",
  "kosan",
  "kostan",
  "oper kontrak",
  "over kontrak",
  "take over",
  "sisa kamar",
  "info kos",
  "sewa kamar",
  "kamar kosong",
  "kontrakan",
  "indekos",
];

export const CITIES: Record<string, CityConfig> = {
  purwokerto: {
    name: "Purwokerto",
    areas: ["Grendeng", "Karangwangkal", "Sumampir", "Bancarkembar"],
    campuses: ["Unsoed", "UMP", "Telkom"],
  },
  yogyakarta: {
    name: "Yogyakarta",
    areas: ["Pogung", "Seturan", "Babarsari", "Gejayan"],
    campuses: ["UGM", "UNY", "UPN", "UII"],
  },
  malang: {
    name: "Malang",
    areas: ["Lowokwaru", "Klojen", "Suhat", "Tlogomas"],
    campuses: ["UB", "UM", "UIN", "Polinema"],
  },
  bandung: {
    name: "Bandung",
    areas: ["Dago", "Coblong", "Buahbatu", "Antapani"],
    campuses: ["ITB", "Unpad", "Telkom"],
  },
  semarang: {
    name: "Semarang",
    areas: ["Tembalang", "Banyumanik", "Pleburan", "Sekaran"],
    campuses: ["Undip", "Unnes", "Udinus"],
  },
  solo: {
    name: "Solo",
    areas: ["Kentingan", "Jebres", "Pabelan", "Manahan"],
    campuses: ["UNS", "UMS"],
  },
};

export interface TelegramTarget {
  source_key: string;
  channel: string;
  city_slug: string;
  is_enabled: boolean;
  note?: string;
}

export const TELEGRAM_CHANNELS: TelegramTarget[] = [
  { source_key: "telegram:infokospurwokerto", channel: "infokospurwokerto", city_slug: "purwokerto", is_enabled: true },
  { source_key: "telegram:infokosmalang", channel: "infokosmalang", city_slug: "malang", is_enabled: true },
  { source_key: "telegram:kostmalang", channel: "kostmalang", city_slug: "malang", is_enabled: true },
  { source_key: "telegram:kossemarang", channel: "kossemarang", city_slug: "semarang", is_enabled: true },
  { source_key: "telegram:kostsolo", channel: "kostsolo", city_slug: "solo", is_enabled: true },
  { source_key: "telegram:infokostsolo", channel: "infokostsolo", city_slug: "solo", is_enabled: true },
  { source_key: "telegram:kosjogjaupdate", channel: "kosjogjaupdate", city_slug: "yogyakarta", is_enabled: false, note: "web preview 302 — kanal tidak publik" },
  { source_key: "telegram:infokosjogja", channel: "infokosjogja", city_slug: "yogyakarta", is_enabled: false, note: "web preview 302 — kanal tidak publik" },
  { source_key: "telegram:carikosjogja", channel: "carikosjogja", city_slug: "yogyakarta", is_enabled: false, note: "web preview 302 — kanal tidak publik" },
  { source_key: "telegram:kosmalang", channel: "kosmalang", city_slug: "malang", is_enabled: false, note: "web preview 302 — kanal tidak publik" },
  { source_key: "telegram:infokossemarang", channel: "infokossemarang", city_slug: "semarang", is_enabled: false, note: "web preview 302 — kanal tidak publik" },
];

const SITE_FILTER: Record<SearchPlatform, string> = {
  twitter_x: "site:x.com OR site:twitter.com",
  facebook: "site:facebook.com",
  instagram: "site:instagram.com",
  web_menfess: "-site:mamikos.com -site:olx.co.id -site:99.co -site:rumah123.com",
};

/**
 * Query pencarian fallback. Maksimal 8 query agar tetap di bawah timeout cron.
 */
export function buildSearchQueries(
  citySlug: string,
  platform: SearchPlatform
): string[] {
  const city = CITIES[citySlug];
  if (!city) return [];

  const filter = SITE_FILTER[platform];
  const places = [
    city.name,
    ...city.campuses.slice(0, 2),
    ...city.areas.slice(0, 2),
  ];

  const queries = places.map((place) => `${filter} kos ${place}`);
  queries.push(`${filter} "oper kontrak" ${city.name}`);
  queries.push(`${filter} "info kos" ${city.campuses[0] ?? city.name}`);

  return queries.slice(0, 8);
}
