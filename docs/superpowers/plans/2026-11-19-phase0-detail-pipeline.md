# KosRadar Phase 0 — Detail Pipeline & Token Gating Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Simpan detail listing yang sudah diekstrak, tampilkan di kartu/modal, dan hentikan pemakaian token LLM untuk post yang datanya sudah lengkap.

**Architecture:** Migrasi DB menambah kolom detail dan metadata sumber. Pipeline dipecah menjadi *prepare → batch enrich → persist*: parser heuristik mengisi sebagian besar field, lalu hanya post yang bolong yang dikirim ke DeepSeek dalam batch maksimal 8 post. API memilih kolom baru, menyensor kontak untuk user gratis lewat satu sanitizer, lalu UI merender rincian harga, kamar, lokasi, aturan, dan sumber. Runner Telegram menjadi config-driven dengan `--dry-run`.

**Tech Stack:** Next.js 16 route handlers, TypeScript, Zod v4, Supabase Postgres, Vitest, Node 20 ESM scripts.

**Spec:** `docs/superpowers/specs/2026-11-18-multiplatform-scraper-design.md` (bagian §7.2, §7.7, §7.8, §7.9, §7.10, §7.11, §7.13 Fase 0)

## Global Constraints

- `raw_text` tidak pernah keluar ke browser.
- User gratis tidak menerima `source_url`, `contact_wa` penuh, atau nomor WA/telepon di **teks apa pun** (`title`, `ai_summary`, `caption`, `address_detail`, `landlord_name`, `nearby_landmarks`). Ganti dengan `[kontak terkunci]`.
- Post yang sudah punya harga + area spesifik + tipe properti **tidak boleh** memanggil LLM.
- Batas AI per HTTP ingest batch: `AI_MAX_CHARS_PER_POST=700`, `AI_MAX_POSTS_PER_RUN=40`, `AI_MAX_CALLS_PER_RUN=8`, maksimal 8 post per panggilan. Runner maksimal 3 batch (120 post) per eksekusi.
- Model LLM hanya `deepseek-chat`.
- Runner hanya memegang `CRON_SECRET` dan `KOSRADAR_URL`; tidak pernah `SUPABASE_SERVICE_ROLE_KEY`.
- Semua DDL idempotent (`add column if not exists`). Proyek Supabase: `jgyznjmvesacgkyjtolf`.
- `npm test`, `npm run lint`, dan `npm run build` harus hijau.
- Sebelum mengubah route handler Next, baca panduan relevan di `node_modules/next/dist/docs/` (lihat `AGENTS.md`).
- Copy UI berbahasa Indonesia dan mengikuti komponen/token desain yang sudah ada.

## Review Focus

1. **Kebocoran nomor WA di teks user gratis.** Post sering menaruh `WA 0812-3456-7890` di `ai_summary`, `caption`, atau nama pemilik. Tes sanitizer + mapper wajib memastikan tidak ada digit nomor yang lolos.
2. **Respons LLM batch yang pendek/berbeda urutan.** Item yang hilang harus fallback heuristik per index, bukan menggeser data ke post lain.
3. **DB lama belum punya kolom baru.** Insert harus tetap berhasil lewat jalur `insertResilient`; jangan sampai ingest gagal total sebelum migrasi diterapkan.
4. **Post non-listing tetap tersaring.** Pengumuman channel/aturan grup tidak boleh masuk hanya karena pipeline diubah.
5. **Caption sangat panjang (>700 karakter).** Harus dipotong sebelum dikirim ke LLM, bukan ditolak atau memicu error.

## File Structure

- `supabase/migrations/20261118_multiplatform.sql` — kolom detail listing + state sumber.
- `src/lib/radar/types.ts` — tipe `RawPost`, `SourcePlatform`, `ParsedListing`, `ListingInsert`.
- `src/lib/radar/parser.ts` — ekstraksi heuristik detail, schema AI, batch parser.
- `src/lib/radar/limits.ts` — pembacaan batas token dari env.
- `src/lib/radar/pipeline.ts` — prepare/batch-enrich/persist.
- `src/lib/radar/sanitize.ts` — sensor kontak terpusat.
- `src/lib/radar/public-listing.ts` — mapper listing → respons publik.
- `src/app/api/listings/route.ts` — select kolom baru + pakai mapper.
- `src/components/ListingCard.tsx`, `src/components/ListingDetailModal.tsx` — render detail.
- `scripts/sources.config.mjs`, `scripts/scrapers/telegram.mjs`, `scripts/lib/http.mjs`, `scripts/run-scraper.mjs` — runner config-driven.
- Test: `src/lib/radar/__tests__/*.test.ts`, `scripts/__tests__/telegram.test.ts`.

---

### Task 0: Cabut fallback `CRON_SECRET` yang bocor

**Files:**
- Create: `scripts/lib/env.mjs`
- Modify: `scripts/run-scraper.mjs:42-45`
- Modify: `.github/workflows/scraper-cron.yml:22-24`
- Test: `scripts/__tests__/env.test.ts`

**Interfaces:**
- Produces: `export function resolveCronSecret(env = process.env): string` — melempar `Error("CRON_SECRET wajib diisi...")` bila kosong.

- [ ] **Step 1: Tulis test gagal**

```ts
expect(resolveCronSecret({ CRON_SECRET: "abc" } as NodeJS.ProcessEnv)).toBe("abc");
expect(() => resolveCronSecret({} as NodeJS.ProcessEnv)).toThrow(/CRON_SECRET wajib/);
```

- [ ] **Step 2: Jalankan test → harus gagal**

Run: `npx vitest run scripts/__tests__/env.test.ts`
Expected: FAIL (modul belum ada).

- [ ] **Step 3: Implementasi helper + hapus fallback**

`scripts/lib/env.mjs`:
```js
export function resolveCronSecret(env = process.env) {
  const secret = (env.CRON_SECRET || env.INGEST_SECRET_KEY || "").trim();
  if (!secret) {
    throw new Error("CRON_SECRET wajib diisi (jangan hardcode di repo).");
  }
  return secret;
}
```
Di `run-scraper.mjs`, ganti blok `const CRON_SECRET = process.env.CRON_SECRET || process.env.INGEST_SECRET_KEY || "283c09..."` dengan import + `resolveCronSecret()`. Panggil hanya saat akan mengirim batch (bukan saat `--dry-run`), sehingga dry-run tetap jalan tanpa secret.

Di workflow, ganti env menjadi:
```yaml
CRON_SECRET: ${{ secrets.CRON_SECRET }}
```
Tanpa fallback.

- [ ] **Step 4: Jalankan test → harus lulus**

Run: `npx vitest run scripts/__tests__/env.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/env.mjs scripts/run-scraper.mjs .github/workflows/scraper-cron.yml scripts/__tests__/env.test.ts
git commit -m "security: remove hardcoded cron secret fallback"
```

- [ ] **Step 6: Rotasi secret (manual, di luar repo)**

Rotasi `CRON_SECRET` di Vercel (Production + Preview), GitHub Actions secrets, dan `.env.local` lokal. Catat di laporan akhir bahwa langkah ini wajib.

---

### Task 1: Migrasi DB detail + state sumber

**Files:**
- Create: `supabase/migrations/20261118_multiplatform.sql`
- Modify: `supabase/schema.sql` (tambahkan blok ALTER yang sama setelah blok valuasi)

**Interfaces:**
- Produces: kolom `listings.source_platform, source_name, address_detail, maps_url, landlord_name, landlord_type, bathroom_type, electricity, water, min_stay_months, available_from, rules, nearby_landmarks, posted_at_source, detail_confidence, caption`; kolom `sources.source_key, cursor, is_enabled, last_status, last_error`.

- [ ] **Step 1: Tulis migrasi idempotent**

```sql
-- Enum platform tambahan (dipakai sources.platform di fase berikutnya)
alter type source_platform add value if not exists 'instagram';
alter type source_platform add value if not exists 'instagram_story';
alter type source_platform add value if not exists 'facebook_page';
alter type source_platform add value if not exists 'tiktok';

alter table listings add column if not exists source_platform      text;
alter table listings add column if not exists source_name          text;
alter table listings add column if not exists address_detail       text;
alter table listings add column if not exists maps_url             text;
alter table listings add column if not exists landlord_name        text;
alter table listings add column if not exists landlord_type        text;
alter table listings add column if not exists bathroom_type        text;
alter table listings add column if not exists electricity          text;
alter table listings add column if not exists water                text;
alter table listings add column if not exists min_stay_months      smallint;
alter table listings add column if not exists available_from       date;
alter table listings add column if not exists rules                jsonb not null default '{}'::jsonb;
alter table listings add column if not exists nearby_landmarks     jsonb not null default '[]'::jsonb;
alter table listings add column if not exists posted_at_source     timestamptz;
alter table listings add column if not exists detail_confidence    numeric(4,3);
alter table listings add column if not exists caption              text;

create index if not exists listings_source_platform_idx
  on listings (source_platform);

alter table sources add column if not exists source_key    text;
alter table sources add column if not exists cursor        jsonb not null default '{}'::jsonb;
alter table sources add column if not exists is_enabled    boolean not null default true;
alter table sources add column if not exists last_status   text;
alter table sources add column if not exists last_error    text;

create unique index if not exists sources_source_key_key on sources (source_key);
```

- [ ] **Step 2: Terapkan migrasi ke Supabase**

Gunakan MCP `apply_migration` dengan name `multiplatform_detail_columns` dan isi SQL di atas. Catat di commit message bahwa migrasi sudah diterapkan.

Jika `apply_migration` menolak `alter type ... add value` karena dijalankan dalam satu transaksi, jalankan empat pernyataan enum itu lebih dulu lewat `execute_sql`, lalu apply sisa migrasi. Jangan menggunakan nilai enum baru di transaksi yang sama.

- [ ] **Step 3: Verifikasi kolom dan enum**

```sql
select table_name, column_name
from information_schema.columns
where table_schema = 'public'
  and ((table_name = 'listings' and column_name in (
        'source_platform','source_name','address_detail','maps_url','landlord_name',
        'landlord_type','bathroom_type','electricity','water','min_stay_months',
        'available_from','rules','nearby_landmarks','posted_at_source',
        'detail_confidence','caption'))
    or (table_name = 'sources' and column_name in (
        'source_key','cursor','is_enabled','last_status','last_error')))
order by table_name, column_name;
```
Expected: 21 baris. Lalu:
```sql
select enumlabel from pg_enum e
join pg_type t on t.oid = e.enumtypid
where t.typname = 'source_platform'
order by enumsortorder;
```
Expected: termasuk `instagram`, `instagram_story`, `facebook_page`, `tiktok`.

- [ ] **Step 4: Samakan `supabase/schema.sql`**

Tambahkan blok `alter table ... add column if not exists` + dua index di atas ke `supabase/schema.sql`, tepat setelah blok kolom valuasi (setelah baris `listings_city_deal_score_idx`).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20261118_multiplatform.sql supabase/schema.sql
git commit -m "feat(db): add listing detail and source state columns"
```

---

### Task 2: Persist metadata sumber & field detail

**Files:**
- Modify: `src/lib/radar/types.ts`
- Modify: `src/lib/radar/pipeline.ts:114-160` (`buildListingRow`), `src/lib/radar/pipeline.ts:74-112` (tetap)
- Test: `src/lib/radar/__tests__/pipeline.test.ts`

**Interfaces:**
- Consumes: kolom Task 1.
- Produces:
```ts
// types.ts
export type SourcePlatform =
  | "facebook_group" | "x_menfess" | "telegram" | "rss" | "web_public"
  | "manual_webhook" | "instagram" | "instagram_story" | "facebook_page" | "tiktok";

export interface RawPost {
  raw_text: string;
  image_urls?: string[];
  source_url?: string;
  city_slug: string;
  platform?: SourcePlatform;
  source_name?: string;       // "@infokosmalang", nama grup, domain
  posted_at_source?: string;  // timestamp asli
  caption?: string;           // teks mentah tanpa markup
  address_hint?: string;
  extra?: Record<string, unknown>;
}

// ParsedListing — field baru OPSIONAL agar test negotiator lama tidak pecah
address_detail?: string | null;
maps_url?: string | null;
landlord_name?: string | null;
landlord_type?: "pemilik" | "penyewa" | "agen" | null;
bathroom_type?: "dalam" | "luar" | null;
electricity?: "token" | "termasuk" | "terpisah" | null;
water?: "termasuk" | "pdam" | "sumur" | null;
min_stay_months?: number | null;
available_from?: string | null;   // YYYY-MM-DD
rules?: Record<string, boolean> | null;
nearby_landmarks?: string[] | null;
```

- [ ] **Step 1: Tulis test gagal untuk persistence**

Di `pipeline.test.ts`, perluas test pertama: kirim `platform: "telegram"`, `source_name: "@infokosmalang"`, `posted_at_source: "2026-11-18T10:00:00+00:00"`, `caption: "Kos putri ..."`, lalu:
```ts
expect(row.source_platform).toBe("telegram");
expect(row.source_name).toBe("@infokosmalang");
expect(row.posted_at_source).toBe("2026-11-18T10:00:00+00:00");
expect(row.caption).toBe("Kos putri ...");
```
Tambahkan test baru: post dengan detail parser heuristik menyimpan `bathroom_type`, `electricity`, `room_size_m2`, `price_raw`.

- [ ] **Step 2: Jalankan test → harus gagal**

Run: `npx vitest run src/lib/radar/__tests__/pipeline.test.ts`
Expected: FAIL karena `source_platform` undefined.

- [ ] **Step 3: Implementasi tipe + mapping**

Tambahkan field di `types.ts` seperti Interfaces. Di `buildListingRow` tambahkan:
```ts
source_platform: post.platform ?? null,
source_name: post.source_name ?? null,
posted_at_source: post.posted_at_source ?? null,
caption: post.caption ?? post.raw_text,
address_detail: parsed.address_detail ?? null,
maps_url: parsed.maps_url ?? null,
landlord_name: parsed.landlord_name ?? null,
landlord_type: parsed.landlord_type ?? null,
bathroom_type: parsed.bathroom_type ?? null,
electricity: parsed.electricity ?? null,
water: parsed.water ?? null,
min_stay_months: parsed.min_stay_months ?? null,
available_from: parsed.available_from ?? null,
rules: parsed.rules ?? {},
nearby_landmarks: parsed.nearby_landmarks ?? [],
```
`stripUndefined` membuang nilai `undefined`; `null` tetap dikirim.

- [ ] **Step 4: Jalankan test → harus lulus**

Run: `npx vitest run src/lib/radar/__tests__/pipeline.test.ts`
Expected: PASS. Test fallback kolom lama tetap lulus.

- [ ] **Step 5: Commit**

```bash
git add src/lib/radar/types.ts src/lib/radar/pipeline.ts src/lib/radar/__tests__/pipeline.test.ts
git commit -m "feat(ingest): persist source metadata and listing detail fields"
```

---

### Task 3: Ekstraksi detail heuristik tanpa token

**Files:**
- Modify: `src/lib/radar/parser.ts` (fungsi helper + `parseHeuristic`)
- Test: `src/lib/radar/__tests__/parser.test.ts`

**Interfaces:**
- Produces:
```ts
export function parseHeuristic(text: string, options?: { now?: Date }): ParsedListing | null;
// helper internal (tidak diekspor kecuali perlu test):
// extractAddressDetail, extractBathroomType, extractElectricity, extractWater,
// extractMinStayMonths, extractAvailableFrom, extractRules, extractNearbyLandmarks
```

- [ ] **Step 1: Tulis test gagal**

Tambahkan di `describe("parseHeuristic")`:
```ts
it("mengekstrak detail kamar, aturan, dan ketersediaan", () => {
  const result = parseHeuristic(
    "Kos putri Jl. Soekarno Hatta Gg. 4 RT 2/RW 5 dekat UB. 800rb/bulan, KM dalam, listrik token, air PDAM, minimal 3 bulan, bisa masuk sekarang, jam malam 22.00, tidak boleh bawa tamu. WA 081234567890",
    { now: new Date("2026-11-19T00:00:00Z") }
  );
  expect(result!.address_detail).toContain("Jl. Soekarno Hatta");
  expect(result!.bathroom_type).toBe("dalam");
  expect(result!.electricity).toBe("token");
  expect(result!.water).toBe("pdam");
  expect(result!.min_stay_months).toBe(3);
  expect(result!.available_from).toBe("2026-11-19");
  expect(result!.rules).toEqual({ has_curfew: true, guests_allowed: false });
  expect(result!.nearby_landmarks).toEqual(["UB"]);
});

it("tidak lagi menulis nomor WA ke ai_summary", () => {
  const result = parseHeuristic("Kos putra 700rb/bulan, WiFi. WA 081234567890");
  expect(result!.contact_wa).toBe("6281234567890");
  expect(result!.ai_summary).not.toMatch(/0812|62812/);
});
```

- [ ] **Step 2: Jalankan test → harus gagal**

Run: `npx vitest run src/lib/radar/__tests__/parser.test.ts`
Expected: FAIL (`address_detail` undefined, `ai_summary` masih memuat WA).

- [ ] **Step 3: Implementasi helper + panggil di `parseHeuristic`**

Aturan exact:
- `extractAddressDetail`: ambil match pertama `/(?:jl\.?|jalan|gg\.?|gang)\s+[^\n,.]+(?:rt\s*\d+\s*\/?\s*rw\s*\d+)?/i`, trim, maks 160 karakter.
- `extractBathroomType`: `km\s*dalam|kamar\s*mandi\s*dalam|kmd` → `"dalam"`; `km\s*luar|kamar\s*mandi\s*luar` → `"luar"`.
- `extractElectricity`: `token` → `"token"`; `listrik\s*(termasuk|include)` → `"termasuk"`; `listrik\s*(terpisah|bayar\s*sendiri)` → `"terpisah"`.
- `extractWater`: `air\s*(termasuk|include)` → `"termasuk"`; `pdam` → `"pdam"`; `sumur` → `"sumur"`.
- `extractMinStayMonths`: `/(?:minimal|min)\s*(\d{1,2})\s*(bulan|bln)/i` → angka; `/(?:minimal|min)\s*(\d{1,2})\s*tahun/i` → `× 12`; maks 24.
- `extractAvailableFrom`: `bisa\s*(masuk|huni)\s*(sekarang|langsung)` → tanggal `now` dengan format `now.toISOString().slice(0, 10)`; `bulan\s*depan` → tanggal 1 bulan berikutnya (UTC, format yang sama).
- `extractRules`: `jam\s*malam\s*\d` → `has_curfew: true`; `bebas\s*jam\s*malam|24\s*jam` → `has_curfew: false`; `(tidak\s*boleh|dilarang)\s*bawa\s*tamu` → `guests_allowed: false`; `boleh\s*bawa\s*tamu|tamu\s*diperbolehkan` → `guests_allowed: true`; `pasutri|suami\s*istri` → `couples_allowed: true`; `khusus\s*(single|sendiri)` → `couples_allowed: false`.
- `extractNearbyLandmarks`: cari `(?:dekat|sekitar|menit\s*dari)\s+([A-Za-z0-9][A-Za-z0-9 .]{1,29}?)(?=[,.\n•\-]|$)`, bersihkan, dedup, maks 3.

Hapus `contactSummary` dari `ai_summary` dan kembalikan semua field baru. `available_from` memakai `options?.now ?? new Date()`.

- [ ] **Step 4: Jalankan test → harus lulus**

Run: `npx vitest run src/lib/radar/__tests__/parser.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/radar/parser.ts src/lib/radar/__tests__/parser.test.ts
git commit -m "feat(parser): extract room, rule, and location detail heuristically"
```

---

### Task 4: Validasi field detail dari AI

**Files:**
- Modify: `src/lib/radar/parser.ts` (`ListingSchema`, `SYSTEM_PROMPT`, `parseAndValidate`)
- Test: `src/lib/radar/__tests__/parser.test.ts`

**Interfaces:**
- Produces: `ListingSchema` dan `parseAndValidate` mengembalikan field detail yang sama dengan `ParsedListing`.

- [ ] **Step 1: Tulis test gagal**

```ts
it("memvalidasi field detail baru dari AI", () => {
  const json = JSON.stringify({
    title: "Kos Putri Melati", price_monthly: 800000, property_type: "kos_putri",
    area_tag: "Lowokwaru", facilities: ["ac"], contact_wa: null,
    is_undervalued: false, ai_summary: "Kos putri di Lowokwaru.",
    address_detail: "Jl. Soekarno Hatta Gg. 4", bathroom_type: "dalam",
    electricity: "token", water: "pdam", min_stay_months: 3,
    available_from: "2026-12-01", rules: { has_curfew: true },
    nearby_landmarks: ["UB"], landlord_name: "Bu Sri", landlord_type: "pemilik",
    maps_url: "https://maps.google.com/?q=-7.9,112.6",
  });
  const result = parseAndValidate(json);
  expect(result!.bathroom_type).toBe("dalam");
  expect(result!.rules).toEqual({ has_curfew: true });
  expect(result!.nearby_landmarks).toEqual(["UB"]);
});

it("memberi default untuk output AI lama tanpa field detail", () => {
  const json = JSON.stringify({
    title: "Kos Lama", price_monthly: 700000, property_type: "kos_campur",
    area_tag: "Seturan", facilities: [], contact_wa: null,
    is_undervalued: false, ai_summary: "Data lama.",
  });
  const result = parseAndValidate(json);
  expect(result!.address_detail).toBeNull();
  expect(result!.bathroom_type).toBeNull();
  expect(result!.rules).toEqual({});
  expect(result!.nearby_landmarks).toEqual([]);
});

it("tidak membuang hasil valid saat satu field detail rusak", () => {
  const json = JSON.stringify({
    title: "Kos Rusak Sebagian", price_monthly: 700000, property_type: "kos_campur",
    area_tag: "Seturan", facilities: [], contact_wa: null,
    is_undervalued: false, ai_summary: "Data.", rules: { has_curfew: "ya" },
  });
  const result = parseAndValidate(json);
  expect(result).not.toBeNull();
  expect(result!.price_monthly).toBe(700000);
  expect(result!.rules).toEqual({});
});
```

- [ ] **Step 2: Jalankan test → harus gagal**

Run: `npx vitest run src/lib/radar/__tests__/parser.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementasi schema + prompt**

Tambahkan ke `ListingSchema` (Zod v4). Field detail memakai `.catch(...)` agar satu nilai rusak tidak menjatuhkan seluruh item:
```ts
address_detail: z.string().max(200).nullable().catch(null).default(null),
maps_url: z.string().url().nullable().catch(null).default(null),
landlord_name: z.string().max(100).nullable().catch(null).default(null),
landlord_type: z.enum(["pemilik", "penyewa", "agen"]).nullable().catch(null).default(null),
bathroom_type: z.enum(["dalam", "luar"]).nullable().catch(null).default(null),
electricity: z.enum(["token", "termasuk", "terpisah"]).nullable().catch(null).default(null),
water: z.enum(["termasuk", "pdam", "sumur"]).nullable().catch(null).default(null),
min_stay_months: z.number().int().positive().max(60).nullable().catch(null).default(null),
available_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().catch(null).default(null),
rules: z.record(z.string(), z.boolean()).catch({}).default({}),
nearby_landmarks: z.array(z.string().max(80)).max(10).catch([]).default([]),
```
Perbarui `SYSTEM_PROMPT`: tambahkan field di contoh JSON dan aturan: tanggal `available_from` format `YYYY-MM-DD`; `rules` hanya key `has_curfew`, `guests_allowed`, `couples_allowed` bernilai boolean; `maps_url` hanya jika ada di teks; jangan mengarang. Map semua field di `parseAndValidate`.

- [ ] **Step 4: Jalankan test → harus lulus**

Run: `npx vitest run src/lib/radar/__tests__/parser.test.ts`
Expected: PASS (termasuk seluruh test lama).

- [ ] **Step 5: Commit**

```bash
git add src/lib/radar/parser.ts src/lib/radar/__tests__/parser.test.ts
git commit -m "feat(parser): validate AI detail fields with safe defaults"
```

---

### Task 5: Batch parser + gating enrichment + batas token

**Files:**
- Create: `src/lib/radar/limits.ts`
- Modify: `src/lib/radar/parser.ts`
- Test: `src/lib/radar/__tests__/parser.test.ts`, `src/lib/radar/__tests__/limits.test.ts`

**Interfaces:**
- Produces:
```ts
// limits.ts
export interface AiLimits {
  maxCharsPerPost: number;  // default 700
  maxPostsPerRun: number;   // default 40
  maxCallsPerRun: number;   // default 8
  batchSize: number;        // default 8
}
export function getAiLimits(env?: NodeJS.ProcessEnv): AiLimits;

// parser.ts
export function needsAiEnrichment(parsed: ParsedListing): boolean;
export interface BatchParseOutput {
  items: (ParsedListing | null)[];
  usage: { prompt_tokens: number; completion_tokens: number } | null;
}
export async function parseListingBatch(
  texts: string[],
  options?: { model?: string; client?: OpenAI; maxCharsPerPost?: number }
): Promise<BatchParseOutput>;
```

- [ ] **Step 1: Tulis test gagal**

`limits.test.ts`:
```ts
expect(getAiLimits({} as NodeJS.ProcessEnv)).toEqual({
  maxCharsPerPost: 700, maxPostsPerRun: 40, maxCallsPerRun: 8, batchSize: 8,
});
expect(getAiLimits({ AI_MAX_CHARS_PER_POST: "500", AI_MAX_POSTS_PER_RUN: "10",
  AI_MAX_CALLS_PER_RUN: "2" } as NodeJS.ProcessEnv).maxCharsPerPost).toBe(500);
```

`parser.test.ts` — tambahkan `describe("needsAiEnrichment")`:
```ts
expect(needsAiEnrichment(parseHeuristic("Kos putri Grendeng 800rb/bln, WiFi")!)).toBe(false);
expect(needsAiEnrichment(parseHeuristic("Kos putri, harga nego, WiFi")!)).toBe(true);
expect(needsAiEnrichment(parseHeuristic("Kos putri 800rb/bln, WiFi")!)).toBe(true); // area generic
```

`describe("parseListingBatch")` dengan fake client:
```ts
const calls: unknown[] = [];
const fakeClient = {
  chat: { completions: { create: async (req: unknown) => {
    calls.push(req);
    return {
      choices: [{ message: { content: JSON.stringify({ items: [
        { index: 1, title: "Kos B", price_monthly: 900000, property_type: "kos_putri",
          area_tag: "Lowokwaru", facilities: [], contact_wa: null,
          is_undervalued: false, ai_summary: "B" },
        { index: 0, title: "Kos A", price_monthly: 800000, property_type: "kos_putri",
          area_tag: "Lowokwaru", facilities: [], contact_wa: null,
          is_undervalued: false, ai_summary: "A" },
      ] }) } },
      ],
      usage: { prompt_tokens: 120, completion_tokens: 60 },
    };
  } } },
} as unknown as OpenAI;

const long = "x".repeat(1000) + " kos 800rb";
const out = await parseListingBatch([long, "post dua"], {
  client: fakeClient, maxCharsPerPost: 700,
});
expect(out.items[0]!.title).toBe("Kos A"); // dicocokkan lewat index, bukan urutan array
expect(out.items[1]!.title).toBe("Kos B");
expect(out.usage).toEqual({ prompt_tokens: 120, completion_tokens: 60 });
const body = JSON.stringify(calls[0]);
expect(body.length).toBeLessThan(1000 + 700);           // teks panjang terpotong
expect(body).not.toContain("x".repeat(701));
```

Tambahkan juga: item index 1 hilang → `items[1]` null (bukan data bergeser), dan tanpa client → semua null + usage null.

- [ ] **Step 2: Jalankan test → harus gagal**

Run: `npx vitest run src/lib/radar/__tests__/limits.test.ts src/lib/radar/__tests__/parser.test.ts`
Expected: FAIL (modul/fungsi belum ada).

- [ ] **Step 3: Implementasi**

`limits.ts`: baca env integer dengan fallback dan clamp minimum 1.

`needsAiEnrichment`:
```ts
const GENERIC_TITLE =
  /^(?:Kos|Kos Putra|Kos Putri|Oper Kontrak)\b.*\b(?:Area Kampus Sekitar|Siap Huni)\b/i;
if (parsed.price_monthly == null) return true;
if (!parsed.area_tag || parsed.area_tag === "Area Kampus Sekitar") return true;
if (parsed.property_type == null) return true;
return GENERIC_TITLE.test(parsed.title);
```

`parseListingBatch`:
- Client lazy seperti `parseListing`. Tanpa client → `{ items: texts.map(() => null), usage: null }`.
- Potong tiap teks ke `maxCharsPerPost ?? getAiLimits().maxCharsPerPost`.
- Satu request, `response_format: { type: "json_object" }`, `temperature: 0.1`, `max_tokens: 2048`.
- System prompt batch: "kembalikan `{ \"items\": [{ \"index\": <angka>, ...field ListingSchema }] }` dengan index sesuai input; item yang gagal diekstrak tetap dikembalikan dengan title kosong atau null".
- User content: `JSON.stringify({ posts: texts.map((text, index) => ({ index, text: truncated })) })`.
- Validasi: refactor `parseAndValidate` menjadi `parseAndValidateObject(value: unknown, silent?)`; item dicocokkan lewat `item.index` (fallback ke posisi array bila `index` bukan integer). Hasil selalu panjang `texts.length`.
- Error jaringan/parse JSON → `{ items: texts.map(() => null), usage: null }` + `console.warn`.

- [ ] **Step 4: Jalankan test → harus lulus**

Run: `npx vitest run src/lib/radar/__tests__/limits.test.ts src/lib/radar/__tests__/parser.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/radar/limits.ts src/lib/radar/parser.ts src/lib/radar/__tests__/limits.test.ts src/lib/radar/__tests__/parser.test.ts
git commit -m "feat(parser): add gated batch parsing with token caps"
```

---

### Task 6: Pipeline prepare → batch enrich → persist

**Files:**
- Modify: `src/lib/radar/pipeline.ts`
- Test: `src/lib/radar/__tests__/pipeline.test.ts`

**Interfaces:**
- Consumes: `needsAiEnrichment`, `parseListingBatch`, `getAiLimits` (Task 5).
- Produces:
```ts
export interface IngestStats {
  total: number; inserted: number; duplicate: number; filtered: number; parse_error: number;
  ai_calls: number; ai_posts: number; prompt_tokens: number; completion_tokens: number;
}
export async function ingestPosts(
  supabase: DbClient,
  posts: RawPost[],
  options?: { client?: OpenAI }
): Promise<{ results: IngestResult[]; stats: IngestStats }>;
// processRawPost tetap diekspor dengan signature lama.
```

- [ ] **Step 1: Tulis test gagal**

Tambahkan `describe("ingestPosts")` dengan fake client dan fake Supabase yang sudah ada:
```ts
const requests: string[] = [];
const fakeClient = {
  chat: { completions: { create: async (req: { messages: { content: string }[] }) => {
    const body = JSON.parse(req.messages[1].content);
    requests.push(req.messages[1].content);
    return {
      choices: [{ message: { content: JSON.stringify({ items:
        body.posts.map((p: { index: number }) => ({
          index: p.index, title: `AI ${p.index}`, price_monthly: 650000,
          property_type: "kos_putri", area_tag: "Lowokwaru", facilities: ["wifi"],
          contact_wa: "081234567890", is_undervalued: false, ai_summary: "AI",
        })),
      }) } }],
      usage: { prompt_tokens: 100, completion_tokens: 40 },
    };
  } } },
} as unknown as OpenAI;

const posts = [
  ...Array.from({ length: 8 }, (_, i) => ({
    raw_text: `Kos putri no ${i}, 650rb/bulan, WiFi, kasur. WA 081234567890`,
    city_slug: "purwokerto",
  })),
  { raw_text: "Kos putri Grendeng, 900rb/bulan, WiFi. WA 081234567890", city_slug: "purwokerto" },
  { raw_text: "Kos putra Grendeng, 850rb/bulan, WiFi. WA 081234567890", city_slug: "purwokerto" },
];
const { results, stats } = await ingestPosts(supabase as never, posts, { client: fakeClient });
expect(results.filter((r) => r.status === "inserted")).toHaveLength(10);
expect(stats.ai_posts).toBe(8);   // 2 post lengkap tidak dikirim ke AI
expect(stats.ai_calls).toBe(1);
expect(requests[0]).not.toContain("Kos putri Grendeng");
expect(stats.prompt_tokens).toBe(100);
```

Test tambahan:
- AI mengembalikan hanya 3 item → 10 tetap tersimpan; 5 lainnya memakai nilai heuristik (`title` bukan `AI ...`).
- Post non-listing (`"Mohon dibaca aturan grup ini..."`) → `filtered`, tidak masuk AI.
- `processRawPost` lama tetap lulus.

- [ ] **Step 2: Jalankan test → harus gagal**

Run: `npx vitest run src/lib/radar/__tests__/pipeline.test.ts`
Expected: FAIL (`ingestPosts` signature/stats belum ada).

- [ ] **Step 3: Refactor pipeline**

- Ekstrak `prepareRawPost(supabase, post, comparableCache)` → `{ early: IngestResult } | { ctx }`, berisi prefilter, dedup, resolve kota, dan fetch comparables.
- Ekstrak `persistCandidate(ctx, parsed)` → `{ signal, roomSizeM2, parsed }` via `prepareCandidate`, quality gate, `buildListingRow`, `insertResilient`, update cache, notifikasi.
- `processRawPost` = `prepareRawPost` → `parseListing(cleanedText)` → `persistCandidate`.
- `ingestPosts`:
  1. Untuk setiap post, `prepareRawPost`; simpan `ctx` + `parseHeuristic(ctx.cleanedText)`. Post yang `early` simpan hasilnya.
  2. Kumpulkan index dengan `needsAiEnrichment(heuristic)`, batasi `maxPostsPerRun`, bagi per `batchSize`, batasi `maxCallsPerRun`. Panggil `parseListingBatch` per chunk dengan `options?.client`; timpa hasil heuristik hanya jika item AI non-null. Akumulasi `ai_calls`, `ai_posts`, dan usage.
  3. Persist semua ctx berurutan; hasil tetap sejajar dengan urutan `posts`.
- Stats tambahan dengan nilai default 0 saat tidak ada AI.

- [ ] **Step 4: Jalankan test → harus lulus**

Run: `npx vitest run src/lib/radar/__tests__/pipeline.test.ts`
Expected: PASS.

- [ ] **Step 5: Sesuaikan batas endpoint**

Di `src/app/api/cron/ingest/route.ts`, ganti batas `posts.length > 50` menjadi `posts.length > 40` dan pesan `Maksimal 40 posts per batch.` (baca panduan route handler Next terlebih dahulu).

- [ ] **Step 6: Commit**

```bash
git add src/lib/radar/pipeline.ts src/app/api/cron/ingest/route.ts src/lib/radar/__tests__/pipeline.test.ts
git commit -m "feat(ingest): batch AI enrichment with token caps"
```

---

### Task 7: Sanitizer kontak terpusat

**Files:**
- Create: `src/lib/radar/sanitize.ts`
- Test: `src/lib/radar/__tests__/sanitize.test.ts`

**Interfaces:**
- Produces:
```ts
export const CONTACT_LOCKED = "[kontak terkunci]";
export function sanitizeFreeText(value: string | null | undefined): string | null;
```

- [ ] **Step 1: Tulis test gagal**

```ts
expect(sanitizeFreeText("Hubungi 0812-3456-7890 ya")).toBe("Hubungi [kontak terkunci] ya");
expect(sanitizeFreeText("Chat wa.me/6281234567890")).toBe("Chat [kontak terkunci]");
expect(sanitizeFreeText("+62 812 3456 7890")).toBe("[kontak terkunci]");
expect(sanitizeFreeText("t.me/+6281234567890")).toBe("[kontak terkunci]");
expect(sanitizeFreeText("Kos dekat UB, 800rb")).toBe("Kos dekat UB, 800rb");
expect(sanitizeFreeText(null)).toBeNull();
expect(sanitizeFreeText(undefined)).toBeNull();
```

- [ ] **Step 2: Jalankan test → harus gagal**

Run: `npx vitest run src/lib/radar/__tests__/sanitize.test.ts`
Expected: FAIL (modul belum ada).

- [ ] **Step 3: Implementasi**

Urutan penting — link dulu, nomor belakangan:
```ts
const WA_LINK = /(?:https?:\/\/)?(?:www\.)?wa\.me\/[^\s)]+/gi;
const TG_PHONE_LINK = /(?:https?:\/\/)?t\.me\/\+?\d[\d\s-]*/gi;
const PHONE = /(?:\+?62|0)[\s.-]?8(?:[\s.-]?\d){7,12}\b/g;

export function sanitizeFreeText(value: string | null | undefined): string | null {
  if (value == null) return null;
  return value
    .replace(WA_LINK, CONTACT_LOCKED)
    .replace(TG_PHONE_LINK, CONTACT_LOCKED)
    .replace(PHONE, CONTACT_LOCKED)
    .trim();
}
```

- [ ] **Step 4: Jalankan test → harus lulus**

Run: `npx vitest run src/lib/radar/__tests__/sanitize.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/radar/sanitize.ts src/lib/radar/__tests__/sanitize.test.ts
git commit -m "feat(api): add central contact sanitizer for free users"
```

---

### Task 8: Mapper respons publik + select kolom baru

**Files:**
- Create: `src/lib/radar/public-listing.ts`
- Modify: `src/app/api/listings/route.ts:68-130` (select + import), hapus fungsi lokal `filterCandidates`/`toPublicListing`
- Test: `src/lib/radar/__tests__/public-listing.test.ts`

**Interfaces:**
- Consumes: `sanitizeFreeText`, `FREE_LISTING_LIMIT`, `DealCandidate`, `DealValuation`.
- Produces:
```ts
export function filterCandidates<T extends DealCandidate>(
  items: { listing: T; valuation: DealValuation }[],
  sp: URLSearchParams
): { listing: T; valuation: DealValuation }[];

export function toPublicListing(
  listing: DealCandidate & Record<string, unknown>,
  valuation: DealValuation,
  isPaid: boolean,
  index: number
): Record<string, unknown>;
```

- [ ] **Step 1: Tulis test gagal**

```ts
const valuation: DealValuation = {
  fair_price_monthly: 1000000, market_low: 900000, market_high: 1100000,
  discount_pct: 20, price_z: -1.2, sample_size: 8, effective_sample: 8,
  confidence: 0.8, risk_score: 0, risk_flags: [], deal_score: 70,
  grade: "B", is_undervalued: true, reasons: [], used_prior: false,
};
const listing = {
  id: 1, title: "Kos Putri 0812-3456-7890", price_monthly: 800000,
  property_type: "kos_putri", area_tag: "Lowokwaru", facilities: ["wifi"],
  image_urls: [], ai_summary: "Hubungi wa.me/6281234567890", posted_at: "2026-11-18T00:00:00Z",
  source_url: "https://t.me/kosmalang/1", contact_wa: "6281234567890",
  caption: "WA 081234567890", landlord_name: "Bu Sri 081234567890",
  address_detail: "Jl. Soekarno Hatta", nearby_landmarks: ["UB 081234567890"],
  rules: {}, raw_text: "rahasia",
};

const free = toPublicListing(listing as never, valuation, false, 0);
expect(free.source_url).toBeNull();
expect(free.contact_wa).toBe("628123456****");
expect(free.caption).toBe("WA [kontak terkunci]");
expect(free.ai_summary).toBe("Hubungi [kontak terkunci]");
expect(free.landlord_name).toBe("Bu Sri [kontak terkunci]");
expect(free.nearby_landmarks).toEqual(["UB [kontak terkunci]"]);
expect(free.raw_text).toBeUndefined();

const locked = toPublicListing(listing as never, valuation, false, 3);
expect(locked.contact_wa).toBeNull();
expect(locked.is_locked).toBe(true);

const paid = toPublicListing(listing as never, valuation, true, 0);
expect(paid.source_url).toBe("https://t.me/kosmalang/1");
expect(paid.contact_wa).toBe("6281234567890");
expect(paid.caption).toBe("WA 081234567890");
```

- [ ] **Step 2: Jalankan test → harus gagal**

Run: `npx vitest run src/lib/radar/__tests__/public-listing.test.ts`
Expected: FAIL (modul belum ada).

- [ ] **Step 3: Implementasi mapper**

Pindahkan `filterCandidates` apa adanya. `toPublicListing`:
- Salin listing, hapus `raw_text`, filter gambar emoji/unsplash/svg seperti sekarang.
- Tambahkan field valuasi seperti sekarang.
- Paid → return apa adanya.
- Gratis → `source_url: null`, mask `contact_wa` 4 digit terakhir (index < 3) atau `null` (index ≥ 3 + `is_locked: true`), lalu sanitasi: `title`, `ai_summary`, `caption`, `address_detail`, `landlord_name`, dan setiap elemen `nearby_landmarks` lewat `sanitizeFreeText`. `rules` dibiarkan (boolean).

- [ ] **Step 4: Wiring API route**

- Import `filterCandidates`, `toPublicListing` dari `@/lib/radar/public-listing`.
- Ganti `select(...)` menjadi:
```
"id, title, price_monthly, price_raw, price_period, price_total, deposit_idr, room_size_m2, is_negotiable, property_type, area_tag, facilities, image_urls, ai_summary, posted_at, posted_at_source, source_url, contact_wa, source_platform, source_name, caption, address_detail, maps_url, landlord_name, landlord_type, bathroom_type, electricity, water, min_stay_months, available_from, rules, nearby_landmarks, raw_text"
```
- Hapus definisi lokal `filterCandidates` dan `toPublicListing`.

- [ ] **Step 5: Jalankan test + build**

Run: `npx vitest run src/lib/radar/__tests__/public-listing.test.ts && npm run build`
Expected: PASS + build sukses.

- [ ] **Step 6: Commit**

```bash
git add src/lib/radar/public-listing.ts src/app/api/listings/route.ts src/lib/radar/__tests__/public-listing.test.ts
git commit -m "feat(api): expose listing detail with free-tier masking"
```

---

### Task 9: Render detail di kartu & modal

**Files:**
- Modify: `src/components/ListingCard.tsx` (`ListingItem`, badge, detail row)
- Modify: `src/components/ListingDetailModal.tsx` (section baru)

**Interfaces:**
- Consumes: field respons dari Task 8.
- Produces: `ListingItem` dengan field opsional:
```ts
price_raw?: string | null;
price_period?: string | null;
price_total?: number | null;
deposit_idr?: number | null;
room_size_m2?: number | null;
is_negotiable?: boolean;
source_platform?: string | null;
source_name?: string | null;
posted_at_source?: string | null;
caption?: string | null;
address_detail?: string | null;
maps_url?: string | null;
landlord_name?: string | null;
landlord_type?: string | null;
bathroom_type?: string | null;
electricity?: string | null;
water?: string | null;
min_stay_months?: number | null;
available_from?: string | null;
rules?: Record<string, boolean> | null;
nearby_landmarks?: string[] | null;
```

- [ ] **Step 1: Kartu — badge platform + baris detail**

- Map label: `telegram → Telegram`, `instagram/instagram_story → Instagram`, `facebook_group/facebook_page → Facebook`, `web_public → Web`, `manual_webhook → Webhook`, lainnya → `Web`.
- Tampilkan badge di pojok kiri bawah foto (kelas `absolute bottom-2.5 left-2.5`), gaya chip putih/95 seperti badge waktu.
- Di bawah area, render baris `Luas {n} m² · KM {dalam/luar} · Listrik {token/termasuk/terpisah}` hanya untuk nilai yang ada, maksimal 3 bagian. Jangan render baris jika kosong.

- [ ] **Step 2: Modal — section baru**

Setelah blok harga/judul, render section berikut hanya jika ada datanya (judul `text-xs font-bold uppercase tracking-wider` seperti section fasilitas):

1. **Rincian Harga**: Harga/bulan (`formatRupiah`), Total kontrak (`price_total`), Deposit (`deposit_idr`), Nego (`Ya`/`Tidak` bila `is_negotiable` boolean), Harga asli (`price_raw`).
2. **Detail Kamar**: Luas (`12 m²`), Kamar mandi (`Dalam`/`Luar`), Listrik, Air, Minimal sewa (`3 bulan`), Tersedia mulai (`toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })`).
3. **Lokasi**: `area_tag`, `address_detail`, dan link `maps_url` ("Buka di Google Maps") bila ada.
4. **Aturan & Sekitar**: chip aturan dari `rules` dengan label:
   `has_curfew:true → "Jam malam berlaku"`, `has_curfew:false → "Bebas jam malam"`, `guests_allowed:true → "Boleh bawa tamu"`, `guests_allowed:false → "Tamu dilarang"`, `couples_allowed:true → "Pasutri diizinkan"`, `couples_allowed:false → "Khusus single"`; lalu chip `nearby_landmarks`.
5. **Sumber** (hanya `isPaid`): `source_platform` label + `source_name` + link `source_url` (jika ada).

Gunakan ikon lucide yang sudah diimpor atau tambah dari set yang sudah dipakai; jaga grid `grid-cols-2`.

- [ ] **Step 3: Verifikasi build + lint**

Run: `npm run build && npm run lint`
Expected: sukses tanpa error TypeScript/ESLint.

- [ ] **Step 4: Verifikasi manual**

Run: `npm run dev`, buka halaman kota yang punya listing hasil Task 10, klik kartu, pastikan section baru muncul dan tidak ada layout pecah di layar sempit.

- [ ] **Step 5: Commit**

```bash
git add src/components/ListingCard.tsx src/components/ListingDetailModal.tsx
git commit -m "feat(ui): render pricing, room, location and source detail"
```

---

### Task 10: Runner Telegram config-driven + `--dry-run`

**Files:**
- Create: `scripts/sources.config.mjs`
- Create: `scripts/lib/http.mjs`
- Create: `scripts/scrapers/telegram.mjs`
- Modify: `scripts/run-scraper.mjs` (rewrite)
- Test: `scripts/__tests__/telegram.test.ts`

**Interfaces:**
- Produces:
```js
// sources.config.mjs
export const SOURCES = [{
  source_key: "telegram:infokosmalang", // stabil
  type: "telegram",
  city_slug: "malang",
  channel: "infokosmalang",
  is_enabled: true,
  note: "web preview aktif",
}, /* ... */];

// scrapers/telegram.mjs
export async function scrapeTelegramChannel(target, ctx): Promise<RawPost[]>;
export function parseTelegramHtml(html, { channel, citySlug, limit }): RawPost[];
```

- [ ] **Step 1: Tulis test parser HTML**

Buat fixture inline (minimal 2 blok `tgme_widget_message_wrap`) berisi: teks berisi "Kos putri", foto `background-image`, satu URL emoji yang harus dibuang, `<time datetime="...">`, dan link `tgme_widget_message_date`. Assertions:
```ts
const posts = parseTelegramHtml(html, { channel: "infokosmalang", citySlug: "malang", limit: 20 });
expect(posts).toHaveLength(1);
expect(posts[0]).toMatchObject({
  city_slug: "malang",
  platform: "telegram",
  source_name: "@infokosmalang",
  source_url: "https://t.me/infokosmalang/123",
  posted_at_source: "2026-11-18T10:00:00+00:00",
});
expect(posts[0].raw_text).toContain("Kos putri");
expect(posts[0].image_urls).toEqual(["https://cdn.example.com/photo.jpg"]);
expect(posts[0].caption).toBe(posts[0].raw_text);
```
Plus: HTML tanpa blok → `[]`; `limit: 1` memotong.

- [ ] **Step 2: Jalankan test → harus gagal**

Run: `npx vitest run scripts/__tests__/telegram.test.ts`
Expected: FAIL (modul belum ada).

- [ ] **Step 3: Pindahkan parser Telegram**

Pindahkan logika regex dari `run-scraper.mjs` ke `scripts/scrapers/telegram.mjs`. Tambahan: `source_name: \`@${channel}\``, `caption: rawText`, `posted_at_source` dari `<time datetime="...">`, filter gambar seperti sekarang, `limit` default 20 per channel. `scrapeTelegramChannel` memakai `fetchText` dari `scripts/lib/http.mjs`.

`http.mjs`: `fetchText(url, { timeoutMs = 20000, retries = 1 })` — User-Agent Chrome, `AbortSignal.timeout`, retry sekali pada 5xx/network error dengan delay 1 detik; return `null` bila gagal.

- [ ] **Step 4: Tulis config sumber**

Enabled (preview publik aktif, sudah diverifikasi):
`infokospurwokerto`, `infokosmalang`, `kossemarang`, `kostsolo`, `infokostsolo`.

Disabled dengan `note: "web preview 302 — kanal tidak publik"`:
`kosjogjaupdate`, `infokosjogja`, `carikosjogja`, `kosmalang`, `infokossemarang`.

Setiap entri memakai `source_key: \`telegram:${channel}\``.

- [ ] **Step 5: Rewrite runner**

- Parse argumen: `--dry-run`, `--source=telegram`, `--limit=N` (default 20 per channel).
- Baca `SCRAPER_ENABLED_SOURCES` (default `telegram`).
- Loop target `is_enabled` dan tipenya sesuai filter, **berurutan**; kumpulkan post; dedup berdasarkan `source_url ?? raw_text`.
- Ringkasan per `source_key`: jumlah post.
- `--dry-run`: print ringkasan + 2 post contoh per sumber, **tidak** memanggil API, tidak butuh `CRON_SECRET`.
- Kirim chunk maksimal 40, **maksimal 3 chunk** per eksekusi. Log `stats` termasuk `ai_calls`, `ai_posts`, `prompt_tokens`, `completion_tokens` bila ada.
- Jangan hardcode daftar channel di runner.

- [ ] **Step 6: Jalankan test + dry-run**

Run: `npx vitest run scripts/__tests__/telegram.test.ts`
Expected: PASS.
Run: `node scripts/run-scraper.mjs --dry-run --source=telegram --limit=5`
Expected: minimal `infokosmalang` atau `kossemarang` menghasilkan >0 post; channel disabled tidak diambil.

- [ ] **Step 7: Commit**

```bash
git add scripts/sources.config.mjs scripts/lib/http.mjs scripts/scrapers/telegram.mjs scripts/run-scraper.mjs scripts/__tests__/telegram.test.ts
git commit -m "feat(scraper): config-driven telegram runner with dry-run"
```

---

### Task 11: Env, dokumentasi, dan verifikasi end-to-end

**Files:**
- Modify: `.env.example`
- Modify: `.github/workflows/scraper-cron.yml` (tambahkan `SCRAPER_ENABLED_SOURCES: telegram`)
- Modify: `DEPLOY.md` (catatan migrasi + env baru)

**Interfaces:**
- Consumes: seluruh task sebelumnya.

- [ ] **Step 1: Dokumentasikan env baru**

Tambahkan ke `.env.example`:
```
# AI token budget (per HTTP ingest batch)
AI_MAX_CHARS_PER_POST=700
AI_MAX_POSTS_PER_RUN=40
AI_MAX_CALLS_PER_RUN=8

# Sumber yang dijalankan runner (dipisah koma)
SCRAPER_ENABLED_SOURCES=telegram
```
Tambahkan catatan di `DEPLOY.md`: migrasi `20261118_multiplatform` harus diterapkan sebelum ingest baru; runner membaca `SCRAPER_ENABLED_SOURCES`.

- [ ] **Step 2: Pastikan `DEEPSEEK_API_KEY` ada di Vercel**

Jalankan `npx vercel env ls` (atau cek dashboard). Bila belum ada, tambahkan untuk Production + Preview. Ini prasyarat enrichment AI; tanpa key pipeline tetap jalan dengan heuristik.

- [ ] **Step 3: Verifikasi penuh**

Run:
```bash
npm test
npm run lint
npm run build
```
Expected: semua hijau.

- [ ] **Step 4: Ingest nyata**

Run: `node scripts/run-scraper.mjs --source=telegram`
Expected: ringkasan per channel + `Batch Ingestion Sukses`; stats memuat `ai_calls`/`ai_posts`/`prompt_tokens`. Periksa di Supabase:
```sql
select count(*) as total,
       count(price_raw) as with_price,
       count(source_platform) as with_platform,
       count(bathroom_type) as with_bathroom
from listings;
```
Expected: `source_platform` terisi untuk listing baru. Bandingkan jumlah listing sebelum/sesudah; target Fase 0 minimal 20 listing nyata (catat angka aktual bila volume channel lebih kecil).

- [ ] **Step 5: Verifikasi browser**

Buka feed kota, klik kartu: section **Rincian Harga**, **Detail Kamar**, **Lokasi**, **Aturan & Sekitar** tampil bila datanya ada. Untuk user gratis: tidak ada nomor WA penuh, tidak ada `source_url`, dan tidak ada nomor WA di teks mana pun.

- [ ] **Step 6: Commit**

```bash
git add .env.example .github/workflows/scraper-cron.yml DEPLOY.md
git commit -m "chore: document phase 0 env and verify end-to-end"
```

---

## Self-Review Notes

- **Spec coverage:** §7.2 (config Telegram, 20 post/channel, 302 disabled) → Task 10. §7.7 (gating + batch + cap + usage) → Task 5–6. §7.8 kolom DB → Task 1–2 (bucket Storage dan sources state API tetap untuk Fase 2, sesuai pembagian fase). §7.9 parser detail → Task 3–4. §7.10 sanitizer + API → Task 7–8. §7.11 kartu/modal → Task 9. Fase 0 (dry-run, persist platform, tampilkan detail) → Task 2, 8, 9, 10.
- **Belum dicakup plan ini (sengaja, fase berikutnya):** adapter web publik, Instagram/Facebook, Supabase Storage, OCR, endpoint state `GET/PUT /api/cron/ingest?state=1`. Semua membutuhkan plan terpisah.
- **Type consistency:** `ParsedListing` field baru opsional; `ListingInsert` memakai field yang sama; `toPublicListing` menerima `DealCandidate & Record<string, unknown>` sehingga field DB baru tidak perlu ditambahkan ke `DealCandidate`.
