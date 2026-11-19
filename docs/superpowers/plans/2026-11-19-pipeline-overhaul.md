# KosRadar — Pipeline Overhaul Plan (Multi-Source + Parser Presisi + UI)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans or superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Ambil listing dari Telegram, X/Twitter, Facebook, Instagram, dan web menfess tanpa saling menjatuhkan; ekstrak harga/detail presisi dengan DeepSeek V4.1 Flash + Zod; tampilkan badge, skema bayar, listrik, fasilitas, dan ringkasan di UI.

**Architecture:** Collector per sumber di `src/lib/scraper/`, dijalankan `Promise.allSettled` dari `/api/cron/scrape`, hasilnya masuk `ingestPosts`. Parser pindah ke `src/lib/ai/parser.ts` dengan field akurasi baru; `src/lib/radar/parser.ts` jadi re-export. DB menambah kolom akurasi. API memilih kolom baru dan menyensor teks gratis. UI merender semua detail.

**Tech Stack:** Next 16 route handlers, TypeScript, Zod v4, Supabase, Vitest, Node 20.

**Spec:** `docs/superpowers/specs/2026-11-18-multiplatform-scraper-design.md` + arahan pemilik 2026-11-19.

## Global Constraints

- Semua collector dipanggil `Promise.allSettled`; satu gagal, yang lain tetap masuk.
- Limit minimal 15-20 kandidat per sumber per siklus.
- AI hanya `deepseek-flash` (display DeepSeek-V4.1-Flash; rilis 1017). Native DeepSeek tidak mendukung `response_format: json_schema`; pakai `json_object` + prompt schema + validasi Zod.
- Larangan: DP/booking fee/deposit tidak boleh jadi harga sewa utama.
- `raw_text` tidak keluar ke browser. Teks gratis disensor `sanitizeFreeText`.
- Batas AI tetap: 700 char/post, 40 post/run, 8 panggilan/run, 8 post/panggilan.
- Secret hanya dari env; tidak ada key hardcoded.
- `npm test`, `npx tsc --noEmit`, `npm run build` hijau.
- Baca `node_modules/next/dist/docs/` sebelum mengubah route handler.

## Review Focus

1. **Harga tahunan/kontrak salah bulan.** `6jt/th` harus jadi `price_monthly=500000`, `price_yearly=6000000`, `billing_cycle="Tahunan"`.
2. **DP/deposit jadi harga sewa.** Harus diabaikan; harga sewa tetap dari nominal sewa.
3. **Satu collector error menjatuhkan semua.** `allSettled` + per-source error report.
4. **Kontak bocor di field baru.** `clean_summary`, `campus_proximity` wajib lewat sanitizer untuk user gratis.
5. **Search fallback tanpa key.** Adapter tanpa Serper/Apify/Nitter key harus skip rapi, bukan crash.

---

### Task 1: Migrasi + tipe field akurasi

**Files:** Create `supabase/migrations/20261119_pipeline_overhaul.sql`; modify `supabase/schema.sql`, `src/lib/radar/types.ts`.

- [ ] **Step 1: DDL idempotent**

```sql
alter table listings add column if not exists gender_type          text;
alter table listings add column if not exists listing_type         text;
alter table listings add column if not exists billing_cycle        text;
alter table listings add column if not exists electricity_included boolean not null default false;
alter table listings add column if not exists campus_proximity     text;
alter table listings add column if not exists clean_summary        text;
alter table listings add column if not exists price_yearly         integer;
alter table listings add column if not exists takeover_price       integer;
alter table listings add column if not exists remaining_months     smallint;
```

- [ ] **Step 2: Apply lewat MCP `apply_migration` name `pipeline_overhaul_fields`; verifikasi 9 kolom via `information_schema.columns`.**

- [ ] **Step 3: Tambah field opsional ke `ParsedListing` dan `ListingInsert`**
```ts
gender_type?: "Putra" | "Putri" | "Campur" | null;
listing_type?: "Kos Baru" | "Oper Kontrak" | null;
billing_cycle?: "Bulanan" | "3 Bulanan" | "Tahunan" | "Sisa Kontrak" | null;
electricity_included?: boolean;
campus_proximity?: string | null;
clean_summary?: string | null;
price_yearly?: number | null;
takeover_price?: number | null;
remaining_months?: number | null;
```

- [ ] **Step 4: Samakan `supabase/schema.sql` + commit** `feat(db): add listing accuracy fields`.

---

### Task 2: Parser pindah ke `src/lib/ai/parser.ts` + prompt harga

**Files:** Create `src/lib/ai/parser.ts`; modify `src/lib/radar/parser.ts` (re-export), `src/lib/radar/__tests__/parser.test.ts`.

**Interfaces:** `export * from "@/lib/ai/parser";` di `src/lib/radar/parser.ts`, sehingga import lama tetap jalan.

- [ ] **Step 1: Test gagal** (di `parser.test.ts`)
```ts
it("membaca harga tahunan menjadi bulanan + billing cycle", () => {
  const r = parseAndValidate(JSON.stringify({
    title: "Kos Putri Tahunan", price_monthly: 500000, price_yearly: 6000000,
    billing_cycle: "Tahunan", property_type: "kos_putri", area_tag: "Lowokwaru",
    facilities: [], contact_wa: null, is_undervalued: false, ai_summary: "Tahunan.",
  }));
  expect(r!.price_monthly).toBe(500000);
  expect(r!.price_yearly).toBe(6000000);
  expect(r!.billing_cycle).toBe("Tahunan");
});

it("membaca oper kontrak takeover + sisa bulan", () => {
  const r = parseAndValidate(JSON.stringify({
    title: "Oper Kontrak 5 Bulan", price_monthly: 480000, takeover_price: 2400000,
    remaining_months: 5, listing_type: "Oper Kontrak", billing_cycle: "Sisa Kontrak",
    property_type: "oper_kontrak", area_tag: "Grendeng", facilities: [], contact_wa: null,
    is_undervalued: false, ai_summary: "Takeover.",
  }));
  expect(r!.takeover_price).toBe(2400000);
  expect(r!.remaining_months).toBe(5);
  expect(r!.listing_type).toBe("Oper Kontrak");
});
```

- [ ] **Step 2: Run test → FAIL** `npx vitest run src/lib/radar/__tests__/parser.test.ts`.

- [ ] **Step 3: Pindahkan implementasi** `src/lib/radar/parser.ts` → `src/lib/ai/parser.ts` (semua ekspor: `ListingSchema`, `parseHeuristic`, `parseListing`, `parseAndValidate`, `parseAndValidateObject`, `needsAiEnrichment`, `parseListingBatch`). `src/lib/radar/parser.ts` cukup `export * from "@/lib/ai/parser";`.

- [ ] **Step 4: Tambah schema + prompt**
Field baru di `ListingSchema`:
```ts
gender_type: z.enum(["Putra", "Putri", "Campur"]).nullable().catch(null).default(null),
listing_type: z.enum(["Kos Baru", "Oper Kontrak"]).nullable().catch(null).default(null),
billing_cycle: z.enum(["Bulanan", "3 Bulanan", "Tahunan", "Sisa Kontrak"]).nullable().catch(null).default(null),
electricity_included: z.boolean().default(false),
campus_proximity: z.string().max(100).nullable().catch(null).default(null),
clean_summary: z.string().max(600).nullable().catch(null).default(null),
price_yearly: z.number().int().nonnegative().nullable().catch(null).default(null),
takeover_price: z.number().int().nonnegative().nullable().catch(null).default(null),
remaining_months: z.number().int().positive().max(60).nullable().catch(null).default(null),
```
`DEEPSEEK_DEFAULT_MODEL = "deepseek-flash"` (komentar: display DeepSeek-V4.1-Flash, rilis 1017). Tetap `response_format: { type: "json_object" }` + Zod.

Aturan prompt tambahan (verbatim ke `SYSTEM_PROMPT`):
```
- Normalisasi: "650k"/"650rb" -> 650000; "7,5jt" -> 7500000; "1,2jt" -> 1200000.
- price_monthly HARUS ekuivalen bulanan. "6jt/th" -> price_monthly 500000, price_yearly 6000000, billing_cycle "Tahunan".
- "3 bulan 1,8jt" -> price_monthly 600000, billing_cycle "3 Bulanan".
- Oper kontrak: takeover_price = total takeover, remaining_months = sisa bulan, price_monthly = takeover_price / remaining_months, billing_cycle "Sisa Kontrak".
- DILARANG memakai DP, booking fee, uang muka, atau deposit sebagai price_monthly/takeover_price.
- clean_summary 2-3 kalimat: kondisi kamar, ukuran, lingkungan, alasan takeover. Tanpa nomor kontak.
- campus_proximity contoh: "± 4 mnt ke Unsoed".
- electricity_included true jika listrik termasuk; false jika token/bayar sendiri.
```

- [ ] **Step 5: Map field di `parseAndValidateObject`; run test + full suite; commit** `feat(parser): add accuracy fields and DeepSeek V4.1 Flash prompt`.

---

### Task 3: Derivasi heuristik akurasi

**Files:** Modify `src/lib/ai/parser.ts`; test `src/lib/radar/__tests__/parser.test.ts`.

- [ ] **Step 1: Test gagal**
```ts
it("menurunkan field akurasi dari teks", () => {
  const r = parseHeuristic(
    "Oper kontrak kos putri Grendeng, 2,4jt sisa 5 bulan, 3x4 m, listrik token, 4 menit ke Unsoed, AC, WiFi, Kasur, Lemari, Parkir Motor. WA 081234567890",
    { now: new Date("2026-11-19T00:00:00Z") }
  );
  expect(r!.gender_type).toBe("Putri");
  expect(r!.listing_type).toBe("Oper Kontrak");
  expect(r!.billing_cycle).toBe("Sisa Kontrak");
  expect(r!.takeover_price).toBe(2400000);
  expect(r!.remaining_months).toBe(5);
  expect(r!.price_monthly).toBe(480000);
  expect(r!.electricity_included).toBe(false);
  expect(r!.campus_proximity).toBe("± 4 mnt ke Unsoed");
  expect(r!.clean_summary).not.toMatch(/0812|62812/);
});

it("harga tahunan jadi bulanan", () => {
  const r = parseHeuristic("Kos putri 6jt/th, AC, WiFi. WA 081234567890");
  expect(r!.price_monthly).toBe(500000);
  expect(r!.price_yearly).toBe(6000000);
  expect(r!.billing_cycle).toBe("Tahunan");
});
```

- [ ] **Step 2: Implementasi helper** di `src/lib/ai/parser.ts`:
  - `deriveGenderType(property_type)` → Putra/Putri/Campur.
  - `deriveListingType` → Oper Kontrak jika oper.
  - `deriveBillingCycle`: oper → "Sisa Kontrak"; `price_period==="year"` → "Tahunan"; teks `3 bulan|per 3 bulan|triwulan` → "3 Bulanan"; selain → "Bulanan".
  - `derivePriceYearly(signal)`: kandidat non-deposit periode `year` → `amount`; fallback null.
  - `deriveTakeover(text, signal)`: jika oper, `takeover_price` = kandidat total non-deposit terbaik (`isTotal` atau periode month dengan `months>1`), `remaining_months` dari `sisa\s*(\d{1,2})\s*(bulan|bln)`.
  - `campus_proximity`: `/(\d{1,2})\s*(menit|mnt|min)\s*(?:dari|ke)\s+([A-Za-z0-9 .]{2,30})/i` → `± N mnt ke Place`; fallback `Dekat <landmark pertama>`.
  - `electricity_included` = `extractElectricity(text) === "termasuk"`.
  - `clean_summary` = `${title}. ${facilities sentence} ${price sentence} ${oper sentence}`. Tanpa kontak.
  - `price_yearly`/`takeover_price`/`remaining_months` juga dikembalikan.

- [ ] **Step 3: Run test → PASS; commit** `feat(parser): derive billing, takeover, campus, and summary fields`.

---

### Task 4: Pipeline + API untuk field akurasi

**Files:** Modify `src/lib/radar/pipeline.ts`, `src/lib/radar/public-listing.ts`, `src/app/api/listings/route.ts`; tests `pipeline.test.ts`, `public-listing.test.ts`.

- [ ] **Step 1: Test gagal**
  - Pipeline row menyimpan `gender_type`, `billing_cycle`, `electricity_included`, `campus_proximity`, `clean_summary`, `price_yearly`, `takeover_price`, `remaining_months` dari hasil heuristic.
  - Free mapper menyensor `clean_summary` dan `campus_proximity`.

- [ ] **Step 2: Implementasi**
  - `buildListingRow` tambah semua field `parsed.* ?? null`; `electricity_included: parsed.electricity_included ?? false`.
  - `SELECT_FIELDS`/select route tambah 9 kolom.
  - `public-listing.ts`: tambah `clean_summary`, `campus_proximity` ke `VISIBLE_TEXT_FIELDS`.

- [ ] **Step 3: Run tests + `npx tsc --noEmit`; commit** `feat(api): persist and mask accuracy fields`.

---

### Task 5: UI badge + detail lengkap

**Files:** Modify `src/components/ListingCard.tsx`, `src/components/ListingDetailModal.tsx`.

- [ ] **Step 1: `ListingItem`** tambah field baru (mirip `ListingParsed`).
- [ ] **Step 2: Card**
  - Badge gender: `Putra` (sky), `Putri` (rose), `Campur` (slate).
  - Badge `Oper Kontrak` (amber) bila `listing_type`.
  - Baris skema bayar: `price_yearly ? "/thn" : "/bln"`; oper → `Oper Kontrak • Sisa {remaining_months} bln`.
  - Chip listrik: `electricity_included ? "Termasuk Listrik" : electricity === "token" ? "Token Listrik" : null`.
  - Fasilitas: tampilkan maksimal 6 chip (dari 3).
- [ ] **Step 3: Modal**
  - Pakai `clean_summary` untuk ringkasan (fallback `ai_summary`).
  - Section Detail Kamar: gender, jenis listing, skema bayar, listrik, air, luas, KM, min sewa, tersedia.
  - Section Harga: harga/bulan, harga/tahun (`price_yearly`), takeover (`takeover_price`), deposit, nego.
  - Section Lokasi: area, alamat, `campus_proximity`, maps.
  - Fasilitas: semua chip.
- [ ] **Step 4: `npm run build && npm run lint`; commit** `feat(ui): show accuracy badges and full detail`.

---

### Task 6: Scraper core + Telegram + `/api/cron/scrape`

**Files:**
- Create: `src/lib/scraper/types.ts`, `config.ts`, `http.ts`, `collect.ts`, `collectors/telegram.ts`, `src/app/api/cron/scrape/route.ts`
- Tests: `src/lib/scraper/__tests__/collect.test.ts`, `telegram.test.ts`, `config.test.ts`

**Interfaces:**
```ts
export type CollectorKey = "telegram" | "twitter_x" | "facebook" | "instagram" | "web_menfess";
export interface Collector { key: CollectorKey; collect(ctx: CollectorContext): Promise<RawPost[]>; }
export interface CollectorContext { citySlug: string; limit: number; env: NodeJS.ProcessEnv; }
export interface CollectorReport { key: CollectorKey; ok: boolean; count: number; error?: string; }
export async function collectAllSources(collectors: Collector[], ctx: CollectorContext): Promise<{ posts: RawPost[]; reports: CollectorReport[] }>;
```

- [ ] **Step 1: Tests gagal**
```ts
it("satu collector gagal tidak menjatuhkan yang lain", async () => {
  const result = await collectAllSources([
    { key: "telegram", collect: async () => [post("a")] },
    { key: "twitter_x", collect: async () => { throw new Error("timeout"); } },
  ], { citySlug: "malang", limit: 20, env: {} });
  expect(result.posts).toHaveLength(1);
  expect(result.reports.find((r) => r.key === "twitter_x")).toMatchObject({ ok: false, count: 0 });
});
```
```ts
it("parse HTML Telegram", () => {
  const posts = parseTelegramHtml(fixture, { channel: "infokosmalang", citySlug: "malang", limit: 20 });
  expect(posts[0]).toMatchObject({ platform: "telegram", source_name: "@infokosmalang", city_slug: "malang" });
  expect(posts[0].raw_text).toContain("Kos putri");
});
```
```ts
it("query memuat keyword dan area", () => {
  const q = buildSearchQueries("malang", "twitter_x");
  expect(q.join(" ")).toContain("kos");
  expect(q.join(" ")).toContain("Malang");
});
```

- [ ] **Step 2: Implementasi**
  - `config.ts`: `KEYWORDS` (kos, kost, kosan, kostan, oper kontrak, over kontrak, take over, sisa kamar, info kos, sewa kamar, kamar kosong, kontrakan, indekos); `CITIES` (6 kota + areas/campuses); `TELEGRAM_CHANNELS` (5 aktif, 5 disabled); `buildSearchQueries(citySlug, platform)` — keyword × kota × kampus, cap 8, prefix `site:x.com OR site:twitter.com` untuk `twitter_x`, `site:facebook.com` untuk facebook, `site:instagram.com` untuk instagram.
  - `http.ts`: `fetchText(url, { timeoutMs=20000, retries=1, headers })` dengan UA, `AbortSignal.timeout`, retry 5xx/network.
  - `telegram.ts`: pindahkan parser regex dari `scripts/run-scraper.mjs`; filter keyword; `limit` default 20; `source_name`, `caption`, `posted_at_source`, `platform: "telegram"`.
  - `collect.ts`: `Promise.allSettled`, report per collector, dedup by `source_url || raw_text`, log counts.
  - Route `POST`/`GET` auth `CRON_SECRET`/`INGEST_SECRET_KEY`; query `city` (allowlist), `sources` (allowlist), `limit` (default 20), `dry_run`; collect → `ingestPosts` (admin client) → JSON `{ reports, totals, ingest }`. `export const maxDuration = 60`.

- [ ] **Step 3: Run tests + build; commit** `feat(scraper): add multi-source collector and scrape cron route`.

---

### Task 7: Adapter X/Twitter, Facebook, Instagram, web menfess

**Files:** Create `src/lib/scraper/search.ts`, `collectors/x.ts`, `facebook.ts`, `instagram.ts`, `web-menfess.ts`; tests `search.test.ts`, `adapters.test.ts`; modify route to include collectors.

- [ ] **Step 1: Tests gagal**
  - `parseNitterRss(xml)` → 2 items, title/description/link/pubDate.
  - `mapSerperResults({ organic: [...] })` → RawPost with `platform` sesuai argumen.
  - `detectLoginWall(html)` true untuk halaman "Log in to Facebook".
  - `x.collect` dengan env tanpa key → `[]` tanpa throw.

- [ ] **Step 2: Implementasi strategi**
  - `search.ts`:
    - `serperSearch(query, limit, env)` → POST `https://google.serper.dev/search`, header `X-API-KEY`, `{ q, num: limit }`; map `organic`.
    - `parseNitterRss(xml)` → regex `<item>`, strip CDATA/tag.
    - `runApifyActor(actorId, input, env)` → POST `https://api.apify.com/v2/acts/{actorId}/run-sync-get-dataset-items?token=...`; map `text|caption|message`, `url|postUrl`, `ownerUsername|pageName`.
    - `detectLoginWall(html)`.
  - `x.ts`: Nitter search RSS (env `NITTER_BASE_URL`) → Serper (`SERPER_API_KEY`) → Apify (`APIFY_TOKEN`, `APIFY_X_ACTOR_ID`), stop di strategi pertama yang menghasilkan post.
  - `facebook.ts`: mbasic group (env `FB_COOKIE`, `FACEBOOK_GROUPS`) → Apify (`APIFY_FACEBOOK_ACTOR_ID`) → Serper; login wall → skip.
  - `instagram.ts`: Apify (`APIFY_INSTAGRAM_ACTOR_ID`) → Serper; no key → skip.
  - `web-menfess.ts`: Serper general search query `kos <city> -site:mamikos.com -site:olx.co.id`; map organic.
  - Semua tanpa key: return `[]`; route report `ok: true, count: 0, skipped: true` (tambah `skipped?` ke report) atau `error` tidak perlu.
  - Platform mapping: `twitter_x` → `x_menfess`, `facebook` → `facebook_group`, `instagram` → `instagram`, `web_menfess` → `web_public`.

- [ ] **Step 3: Run tests; commit** `feat(scraper): add search, nitter, apify, and social adapters`.

---

### Task 8: Trigger script, env, workflow, verifikasi

**Files:** Modify `scripts/run-scraper.mjs`, `.env.example`, `.github/workflows/scraper-cron.yml`, `DEPLOY.md`.

- [ ] **Step 1: Ganti `run-scraper.mjs` jadi trigger**
  - Load `.env.local` (tetap), parse `--dry-run`, `--city=`, `--sources=`, `--limit=`.
  - POST/GET ke `${KOSRADAR_URL}/api/cron/scrape?...` dengan `Authorization: Bearer resolveCronSecret()` (kecuali dry-run tetap butuh auth karena route mengembalikan raw text).
  - Print `reports`, `totals`, `ingest.stats`.

- [ ] **Step 2: Env + workflow**
  - `.env.example`: `SERPER_API_KEY=`, `APIFY_TOKEN=`, `APIFY_X_ACTOR_ID=`, `APIFY_FACEBOOK_ACTOR_ID=`, `APIFY_INSTAGRAM_ACTOR_ID=`, `NITTER_BASE_URL=`, `FACEBOOK_GROUPS=`, `SCRAPER_CITY=malang`, `SCRAPER_SOURCES=telegram,twitter_x,facebook,instagram,web_menfess`, `SCRAPER_LIMIT=20`, `DEEPSEEK_MODEL=deepseek-flash`.
  - Workflow: tetap `node scripts/run-scraper.mjs`; env `KOSRADAR_URL`, `CRON_SECRET`, `SCRAPER_CITY` (matrix 6 kota optional).
  - `DEPLOY.md`: catatan route baru + key opsional.

- [ ] **Step 3: Verifikasi**
  - `npm test`, `npx tsc --noEmit`, `npm run build`.
  - `node scripts/run-scraper.mjs --dry-run --city=malang --sources=telegram --limit=5` terhadap `npm run dev` lokal (atau produksi) → ≥1 post Telegram, report ok.
  - Tanpa key Serper/Apify: adapter lain skip, tidak error.
  - Ingest nyata 1 kota → cek `listings` bertambah dan field akurasi terisi.

- [ ] **Step 4: Commit** `feat(scraper): wire multi-source cron and document keys`.

---

## Self-Review

- Semua arahan pemilik: multi-source (Task 6-7), keyword lokal (Task 6 config), fallback RSS/Serper/Apify (Task 7), limit 15-20 (config/route), parser DeepSeek V4.1 Flash + Zod + aturan harga (Task 2-3), field UI (Task 4-5), UI badges (Task 5).
- Tahap lama yang sudah selesai (migrasi detail, sanitizer, batch AI, API mapper) dipakai ulang.
- Tidak ada push/deploy di plan; hanya commit lokal.
