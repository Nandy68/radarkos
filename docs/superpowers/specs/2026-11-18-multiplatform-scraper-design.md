# KosRadar — Desain Scraper Multi-Platform & Detail Listing

Tanggal: 2026-11-18
Status: menunggu persetujuan

## 1. Intent & alasan

KosRadar saat ini hanya mengambil data dari Telegram, dan channel Telegram yang
dipakai sebagian besar sudah mati. Database produksi berisi **1 listing**.
Akibatnya website menampilkan data statis fallback dan detail listing terasa
dangkal.

Tujuan perubahan ini:

1. Mengambil listing kos murah dari banyak platform: Telegram, Instagram
   (post + story), Facebook (grup + halaman), dan web publik (OLX, Mamikos,
   99.co, dan sejenisnya).
2. Mengekstrak informasi jauh lebih detail tanpa membengkakkan biaya token LLM.
3. Menampilkan detail itu di website: rincian harga, deposit, luas kamar,
   fasilitas lengkap, alamat/area, status nego, dan platform sumber.

Keputusan akses yang sudah diambil pemilik produk: **tidak memakai API resmi
Meta/Apify**, melainkan **akun/sesi Instagram & Facebook milik sendiri**
(akun khusus, bukan akun pribadi).

## 2. Goals

- Feed terisi dari minimal 4 jenis sumber: Telegram, Instagram, Facebook,
  web publik; masing-masing dengan adapter terpisah.
- Post yang sudah punya harga + area + tipe properti **tidak memanggil LLM**.
- LLM hanya dipakai untuk post yang informasinya bolong, dan dipanggil
  secara batch (beberapa post dalam satu request).
- Detail listing yang tersimpan di DB benar-benar sampai ke browser dan
  dirender di kartu/detail modal.
- Ada mode `--dry-run` untuk mencoba adapter tanpa menulis ke database.

## 3. Non-goals

- Tidak menembus grup privat yang belum di-join akun.
- Tidak menyimpan password Instagram/Facebook. Hanya cookie sesi.
- Tidak melakukan automation engagement (like, follow, DM massal).
- Tidak mengambil story akun yang tidak di-follow akun scraper.
- Tidak membangun panel admin baru; konfigurasi sumber lewat file config
  dan environment variables.

## 4. Anti-goals (dianggap gagal walau teknis berjalan)

- Akun scraper kena checkpoint/ban karena request terlalu agresif.
- Biaya LLM naik karena setiap post dikirim ke AI.
- Nomor WhatsApp gratis bocor ke browser untuk user yang belum bayar.
- Data mentah berisi spam/penipuan masuk tanpa filter.

## 5. Kondisi saat ini (hasil pemeriksaan)

- `scripts/run-scraper.mjs` hanya punya 10 target `type: "telegram"`.
- 5 dari 10 channel mengembalikan HTTP 302 (tidak ada). Dari 5 yang hidup,
  hanya `infokosmalang` dan `kossemarang` yang berisi postingan kos.
- `RawPost.platform` diterima pipeline tetapi **tidak pernah disimpan** ke DB.
- `src/app/api/listings/route.ts` tidak mengambil `price_raw`, `price_period`,
  `price_total`, `deposit_idr`, `room_size_m2`, `is_negotiable`, dan platform.
- `ListingDetailModal.tsx` belum menampilkan field-field tersebut.
- Listing terakhir di DB diproses parser heuristik (judul `"Kos Siap Huni — ..."`,
  area `"Area Kampus Sekitar"`), bukan AI. Kemungkinan besar
  `DEEPSEEK_API_KEY` belum diset di environment Vercel; key lokal valid.

## 6. Pendekatan yang dipertimbangkan

### A. Semua adapter dibangun sekaligus
Telegram, Instagram, Facebook, web publik, dan pipeline detail dalam satu
perubahan besar. Lengkap, tetapi lama terlihat hasilnya dan sulit diuji.

### B. Apify penuh + webhook
Apify menjadwalkan scraping dan mengirim hasil ke `/api/webhook/ingest`.
Paling sedikit kode, tetapi dedup lintas platform dan batas token sulit
dikontrol.

### C. Adapter di repo, bertahap (dipilih)
Adapter per platform berada di repo. Fase 1 memperbaiki Telegram + web publik
+ tampilan detail. Fase 2 menambahkan adapter akun/sesi Instagram & Facebook
(termasuk story). Fase 3 OCR dan perluasan platform.

Alasan memilih C:

- Dampak terbesar (database kosong) bisa diperbaiki lebih dulu dengan sumber
  gratis.
- Normalisasi, dedup, dan anggaran token tetap di satu tempat.
- Adapter Meta bisa diuji dengan `--dry-run` sebelum dijalankan rutin.
- Tidak mengunci arsitektur ke satu vendor.

## 7. Desain

### 7.1 Struktur adapter

```
scripts/
  run-scraper.mjs              # orkestrator: pilih adapter, batasi run, kirim batch
  sources.config.mjs           # daftar target per kota (channel, hashtag, grup, URL)
  lib/
    http.mjs                   # fetch + retry + delay + proxy opsional
    cookies.mjs                # parsing cookie string, validasi sesi
    rate-limit.mjs             # token bucket per platform
    media.mjs                  # unduh, validasi ukuran/mime, kompres
    storage.mjs                # upload ke Supabase Storage via signed URL
    ocr.mjs                    # OCR poster/story (fase 2 untuk ekstraksi kontak)
    extract.mjs                # JSON-LD / OpenGraph / meta parser untuk web publik
  scrapers/
    telegram.mjs
    instagram.mjs
    facebook.mjs
    web-public.mjs
```

Kontrak setiap adapter:

```js
// (target, ctx) => Promise<RawPost[]>
{
  raw_text: string,
  image_urls?: string[],
  source_url?: string,
  city_slug: string,
  platform: SourcePlatform,
  source_name?: string,      // @akun, nama grup, domain
  posted_at_source?: string, // timestamp asli jika tersedia
  caption?: string,          // teks asli tanpa markup
  address_hint?: string,
  extra?: Record<string, unknown>
}
```

Adapter **hanya mengambil dan membersihkan data mentah**. Parsing harga,
dedup, valuasi, dan AI tetap di server (`src/lib/radar`).

### 7.2 Adapter Telegram (fase 1)

- Ganti daftar channel mati. Pakai channel yang terbukti hidup dan relevan;
  minimal `infokosmalang`, `kossemarang`, plus channel kota lain yang dicek
  manual.
- Tambah dukungan channel dari config, bukan hardcode.
- Tetap pakai `https://t.me/s/<channel>`, filter emoji/icon seperti sekarang.
- Batasi 20 post terbaru per channel per run, dedup URL.
- Jika channel tidak ada (302), tandai disabled di config agar tidak dicek
  terus.

### 7.3 Adapter web publik (fase 1)

Sumber: OLX, Mamikos, 99.co/Rumah123, dan situs listing lain yang halamannya
publik. Cakupan kota mengikuti 6 kota yang sudah di-seed: Purwokerto,
Yogyakarta, Malang, Bandung, Semarang, Solo. Hanya halaman publik tanpa
login; `robots.txt` dan ToS portal dihormati (jangan mengambil halaman yang
dilarang, jangan menembus paywall). Seed URL per domain/kota disiapkan
builder dan disimpan di `sources.config.mjs`; kalau struktur halaman berubah,
cukup perbarui config.

Strategi ekstraksi berlapis:

1. **JSON-LD** (`application/ld+json`) — ambil `name`, `description`,
   `offers.price`, `address`, `image`, `url`. Ini paling stabil dan kaya detail.
2. **OpenGraph/meta tags** — fallback untuk judul, deskripsi, gambar.
3. **HTML selector per situs** — hanya jika 1 dan 2 tidak ada; selector
   disimpan di config per domain agar mudah diperbaiki.

Satu adapter generik dengan profil per domain. Tidak perlu login.

### 7.4 Adapter Instagram berbasis akun (fase 2)

**Tempat jalan:** adapter ini **tidak** dijalankan di GitHub Actions. Ia
dijalankan dari PC Windows lokal (Task Scheduler) memakai IP residensial,
karena IP datacenter hampir pasti memicu login wall/checkpoint Meta. GitHub
Actions tetap menangani Telegram dan web publik.

Input dari environment (hanya di `.env.local` PC lokal):

```
IG_SESSIONID=...
IG_CSRFTOKEN=...
IG_DS_USER_ID=...
IG_USER_AGENT=...            # opsional
SCRAPER_PROXY_URL=...        # opsional, untuk menghindari login wall
```

Target dari `sources.config.mjs`:

- `hashtags`: `#kosmalang`, `#infokosjogja`, `#operkontrakmalang`, ...
- `profiles`: akun info kos / agen / fess yang relevan.
- `stories`: username yang di-follow akun scraper (story hanya terlihat
  untuk akun yang di-follow).

Endpoint yang dipakai (dipisah di satu modul agar mudah diganti saat
Instagram mengubah API):

- `GET /api/v1/feed/tag/{tag}/?count=12`
- `GET /api/v1/users/web_profile_info/?username={username}`
- `GET /api/v1/feed/user/{user_id}/?count=12`
- `GET /api/v1/feed/reels_media/?reel_ids={user_id}` (story)

Header wajib: `x-ig-app-id: 936619743392459`, `x-csrftoken`, `cookie`,
`referer`, `user-agent`.

Aturan keselamatan akun:

- Maksimal **1 request / 4 detik** dan maksimal **60 request per run**.
- Berhenti total saat menerima 429/`checkpoint_required`, catat status ke
  `sources.last_error`, lanjut run berikutnya.
- Tidak ada retry agresif; maksimal 2 retry dengan backoff.
- Hanya membaca; tidak follow/like/comment.

`raw_text` untuk post IG = caption + nama akun + lokasi (jika ada).
Story: teks dari caption/sticker jika tersedia; gambar disimpan untuk OCR
fase 3.

### 7.5 Adapter Facebook berbasis akun (fase 2)

**Tempat jalan:** sama dengan Instagram — dari PC Windows lokal, bukan GitHub
Actions.

Input (hanya di `.env.local` PC lokal):

```
FB_COOKIE=c_user=...; xs=...; datr=...; fr=...
FB_USER_AGENT=...
```

Target: grup publik/pribadi yang **sudah di-join** akun scraper, dan halaman
publik. Config berisi `group_id` atau slug + `city_slug`.

Strategi:

1. `https://mbasic.facebook.com/groups/{id}` — HTML lebih sederhana.
2. Fallback `https://www.facebook.com/groups/{id}` dengan cookie.
3. Ambil post + timestamp + permalink (`/posts/{id}`) + teks + foto.
4. Hormati login wall: jika respons mengandung form login, hentikan adapter
   dan laporkan, jangan retry.

Batasan yang sama dengan Instagram: 1 request / 5 detik, maksimal 40 request
per run, berhenti saat checkpoint.

**Catatan risiko (disetujui pemilik produk):** otomasi ini melanggar ToS Meta
dan akun dapat dibatasi/diblokir. Mitigasi: akun khusus (burner), bukan akun
pribadi; cookie hanya disimpan di GitHub Actions secrets; tidak ada
password; proxy opsional.

### 7.6 Orkestrasi & state

`run-scraper.mjs`:

1. Baca `SCRAPER_ENABLED_SOURCES` (mis. `telegram,web,instagram,facebook`).
2. Jalankan adapter secara berurutan dengan jeda, bukan paralel, agar tidak
   memicu rate limit.
3. Kumpulkan `RawPost[]`.
4. Buang duplikat URL dalam satu run.
5. Kirim ke `/api/cron/ingest` per batch maksimal 40 post.
6. Tampilkan ringkasan: per platform, jumlah diambil, jumlah terkirim.

**Sumber kebenaran target:** `sources.config.mjs` adalah registry target yang
authoritative. Tabel `sources` **hanya menyimpan state runtime**, bukan daftar
target. Setiap target punya `source_key` stabil (mis.
`telegram:infokosmalang`, `instagram:hashtag:kosmalang`,
`facebook:group:123456789`, `web:olx:malang`) yang menjadi kunci state.

Konsekuensi skema: tambah `source_key text unique not null` di `sources` dan
_longgarkan_ ketergantungan pada `unique(city_id, url)`. Baris seed FB/X lama
yang tidak lagi dipakai ditandai `is_enabled=false`, bukan dihapus.

**Akses state dari runner:** runner GitHub Actions **tidak** memegang
`SUPABASE_SERVICE_ROLE_KEY`. `/api/cron/ingest` diperluas menjadi endpoint
state:

- `GET /api/cron/ingest?state=1` → `{ source_state: [{ source_key, cursor,
  last_status, last_error, last_scraped_at }] }`.
- `PUT /api/cron/ingest` dengan `{ source_state: [...] }` → upsert state.

Keduanya memakai autentikasi `CRON_SECRET` yang sudah ada. Dengan begitu scope
secret runner tetap sempit.

Contoh cursor IG:
`{ "last_media_id": "...", "last_story_fetch_at": "..." }`.

**Penyimpanan media (dipilih: Supabase Storage).** Foto dan story IG/FB
diunduh saat scrape, bukan di-hotlink, karena URL CDN Instagram/Facebook
kedaluwarsa dan story hilang setelah 24 jam.

- Bucket: `listing-media` (public read, write hanya service role).
- Batas: maksimal 3 media per listing, masing-masing ≤1.5MB, hanya
  `image/jpeg|png|webp`.
- Alur: runner meminta signed upload URL ke
  `POST /api/cron/media/sign` (auth `CRON_SECRET`) → runner mengunduh media
  → `PUT` ke signed URL → `image_urls` yang dikirim ke ingest berisi URL
  publik Supabase.
- Server tetap satu-satunya pemegang `SUPABASE_SERVICE_ROLE_KEY`; runner
  tidak pernah menyimpannya.
- Telegram dan web publik tetap boleh memakai hotlink; hanya IG/FB/story yang
  wajib diunduh.

**Pemisahan runner.**

| Runner | Sumber | Jadwal |
|---|---|---|
| GitHub Actions | Telegram, web publik | tiap 30 menit |
| PC Windows lokal (Task Scheduler) | Instagram, Facebook | tiap 30 menit |

Keduanya POST ke endpoint ingest yang sama dan memakai `CRON_SECRET` yang
sama. State cursor dibagi lewat `/api/cron/ingest?state=1`.

### 7.7 Penghematan token (inti)

Pipeline diubah menjadi tiga tahap di `src/lib/radar/pipeline.ts`:

1. `prepareBatch(posts)` — prefilter, dedup DB, resolve kota, ekstraksi
   deterministik (`extractPriceSignal`, `extractRoomSizeM2`,
   `parseHeuristic`).
2. `enrichBatch(candidates)` — hanya kandidat yang **butuh** AI yang dikirim,
   dalam satu request berisi maksimal 8 post.
3. `persistBatch(candidates)` — valuasi, insert, notifikasi.

Kriteria `needsAiEnrichment`:

```
price_monthly == null
ATAU area_tag null / "Area Kampus Sekitar"
ATAU property_type null
ATAU title mengandung pola generik ("Kos Siap Huni —", "Kos Putra —", dst.)
```

Batas keras (didefinisikan **per HTTP batch**, bukan per eksekusi script,
karena endpoint ingest stateless):

- `AI_MAX_CHARS_PER_POST=700` (potong teks sebelum dikirim).
- `AI_MAX_POSTS_PER_RUN=40` → maksimal 40 post per request ingest.
- `AI_MAX_CALLS_PER_RUN=8` → maksimal 8 panggilan LLM per request ingest
  (satu panggilan bisa berisi sampai 8 post).
- Runner mengirim maksimal **3 batch per eksekusi**, jadi plafon efektif
  adalah 120 post dan 24 panggilan LLM per run.
- Hanya model `deepseek-chat`.
- Catat `usage.prompt_tokens` / `completion_tokens` di respons ingest dan log.

**Tidak ada penundaan/pending state.** Kalau dalam satu batch hanya <4 post
yang butuh AI, post tersebut langsung memakai hasil heuristik dan tidak
disimpan untuk AI run berikutnya. Dedup berbasis `source_hash` berarti post
yang sama tidak akan diproses ulang, jadi menunda hanya akan menghilangkan
kesempatan enrichment. Ini keputusan sadar: kehilangan sedikit detail lebih
baik daripada menambah tabel pending + kontrak API baru.

Post dari web publik yang punya JSON-LD harga+alamat biasanya **tidak**
butuh AI.

Dan yang lebih penting: data terstruktur dari JSON-LD/OpenGraph diisi
langsung ke field yang sesuai sebelum pipeline, sehingga kebutuhan AI turun.

### 7.8 Perubahan skema database

Migrasi baru: `supabase/migrations/20261118_multiplatform.sql`.

Enum `source_platform` ditambah:

```
instagram
instagram_story
facebook_page
tiktok
```

Kolom baru di `listings`:

| Kolom | Tipe | Kegunaan |
|---|---|---|
| `source_platform` | enum/text | platform asal |
| `source_name` | text | @akun / nama grup / domain |
| `address_detail` | text | alamat spesifik |
| `maps_url` | text | link peta |
| `landlord_name` | text | nama pemilik/penyewa |
| `landlord_type` | text | pemilik / penyewa oper kontrak / agen |
| `bathroom_type` | text | dalam / luar |
| `electricity` | text | token / termasuk / terpisah |
| `water` | text | termasuk / PDAM / sumur |
| `min_stay_months` | smallint | durasi sewa minimum |
| `available_from` | date | kapan bisa dihuni |
| `rules` | jsonb | jam malam, gender, tamu, dll |
| `nearby_landmarks` | jsonb | kampus/terminal terdekat |
| `posted_at_source` | timestamptz | waktu posting asli |
| `detail_confidence` | numeric(4,3) | keyakinan kelengkapan detail |
| `caption` | text | teks asli yang aman ditampilkan (tanpa kontak) |

Kolom baru di `sources`:

| Kolom | Tipe | Kegunaan |
|---|---|---|
| `source_key` | text unique | kunci stabil dari config (`telegram:...`, `instagram:hashtag:...`) |
| `cursor` | jsonb | posisi terakhir |
| `is_enabled` | boolean | on/off per sumber |
| `last_status` | text | ok / login_wall / rate_limited |
| `last_error` | text | pesan error terakhir |

Bucket Storage baru: `listing-media` (public read, service-role write,
batas 2MB, mime image). Dibuat lewat migrasi SQL atau dashboard Supabase.

Semua `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` agar idempotent.

### 7.9 Parser & ekstraksi detail

`src/lib/radar/parser.ts`:

- Tambah field ke `ListingSchema` dan `ParsedListing`.
- Tambah `parseListingBatch(texts, opts)`:
  - satu system prompt, user content berupa array JSON post;
  - output array JSON dengan urutan sama;
  - validasi per item; item gagal → fallback heuristik.
- `parseListing` tetap ada untuk kompatibilitas dan test lama.
- Prompt baru meminta field detail: alamat, tipe kamar mandi, listrik, air,
  deposit, durasi minimum, tersedia mulai, aturan, landmark, nego.
- Prompt tetap melarang mengarang data.

`parseHeuristic` diperluas tanpa biaya token:

- ekstrak alamat dari pola `Jl. ...`, `Gg. ...`, `RT/RW`;
- ekstrak tipe KM (dalam/luar), listrik (token/tagihan/termasuk), air;
- ekstrak durasi minimum (`minimal 3 bulan`, `min 6 bln`);
- ekstrak ketersediaan (`bisa masuk sekarang`, `kosong bulan depan`);
- ekstrak aturan (`jam malam`, `bawa tamu`, `pasutri`, `bebas`);
- ekstrak gender lebih lengkap (putra/putri/campur).

### 7.10 API listing

`src/app/api/listings/route.ts`:

- Select semua field aman yang baru (kecuali `raw_text`).
- Sertakan `source_platform`, `source_name`, `source_url` (source_url tetap
  null untuk user gratis).
- Sertakan `price_raw`, `price_period`, `price_total`, `deposit_idr`,
  `room_size_m2`, `is_negotiable`, `bathroom_type`, `electricity`, `water`,
  `min_stay_months`, `available_from`, `rules`, `nearby_landmarks`,
  `address_detail`, `landlord_name`, `landlord_type`, `maps_url`,
  `posted_at_source`, `caption`.
- `caption` disanitasi: nomor WA dihapus/dimasker untuk user gratis.
- `raw_text` tetap tidak pernah keluar ke browser.

**Sanitizer terpusat untuk semua string yang terlihat user gratis.** Bukan
hanya `caption`: `title`, `ai_summary`, `address_detail`, `landlord_name`,
`rules`, `nearby_landmarks`, dan hasil OCR semuanya melewati
`sanitizeFreeText()` yang mengganti pola nomor WA/telepon/`wa.me`/`t.me`
kontak menjadi `[kontak terkunci]`. `parseHeuristic` berhenti menulis
"Hubungi WA: ..." ke `ai_summary`; kontak hanya masuk `contact_wa`.
Test regresi wajib memastikan tidak ada nomor WA yang lolos di respons user
gratis.

### 7.11 Tampilan website

**Kartu (`ListingCard.tsx`)**

- Badge platform (Telegram / Instagram / Facebook / OLX) di pojok foto.
- Baris kecil: `Luas 3x4 m · KM Dalam · Listrik token` jika tersedia.
- Fasilitas tetap maksimal 3–4 chip.

**Detail modal (`ListingDetailModal.tsx`)**

Urutan section:

1. Galeri foto (sudah ada).
2. Harga + badge diskon pasar (sudah ada).
3. **Rincian Harga** (baru): harga/bulan, harga total kontrak, deposit,
   status nego, periode asli.
4. **Detail Kamar** (baru): luas m², KM dalam/luar, listrik, air, durasi
   minimum, tersedia mulai.
5. **Lokasi** (baru): area, alamat detail, link Google Maps (jika ada).
6. Fasilitas lengkap (sudah ada, ditambah jumlah).
7. Catatan verifikasi + analisis pasar (sudah ada).
8. **Aturan & sekitarnya** (baru): chips aturan, landmark terdekat.
9. Kontak pemilik (tetap berbayar).
10. **Sumber** (baru, berbayar): platform + link postingan asli.

Untuk user gratis: semua detail di atas tetap terlihat; hanya kontak WA dan
`source_url` yang dikunci. Ini keputusan saya — detail adalah nilai jual,
kontak adalah barang berbayar.

### 7.12 Konfigurasi & secrets

`.env.example` ditambah:

```
# Instagram (akun khusus)
IG_SESSIONID=
IG_CSRFTOKEN=
IG_DS_USER_ID=
IG_USER_AGENT=

# Facebook (akun khusus)
FB_COOKIE=
FB_USER_AGENT=

# Opsional
SCRAPER_PROXY_URL=
SCRAPER_ENABLED_SOURCES=telegram,web
AI_MAX_CHARS_PER_POST=700
AI_MAX_POSTS_PER_RUN=40
AI_MAX_CALLS_PER_RUN=8
```

Pembagian secret:

- **GitHub Actions:** `CRON_SECRET`, `KOSRADAR_URL`. Tidak lebih.
- **PC Windows lokal (`.env.local`):** `IG_SESSIONID`, `IG_CSRFTOKEN`,
  `IG_DS_USER_ID`, `FB_COOKIE`, `CRON_SECRET`, `KOSRADAR_URL`, dan
  `SUPABASE_URL`/anon key bila diperlukan untuk signed upload.
- `SUPABASE_SERVICE_ROLE_KEY` hanya ada di Vercel.
- Tidak ada cookie yang masuk repo.

### 7.13 Fase pekerjaan

**Fase 0 — perbaikan cepat (tanpa akun Meta)**
- Hapus channel Telegram mati; tambah channel hidup.
- Persist `platform`, `source_name`, `posted_at_source`.
- Kirim & tampilkan detail yang sudah tersimpan (harga total, deposit, luas,
  nego, dll).
- Pastikan `DEEPSEEK_API_KEY` ada di Vercel.
- Tambah `--dry-run`.
- Acceptance: minimal 20 listing nyata masuk DB; modal menampilkan rincian
  harga/kamar; tidak ada LLM call untuk post yang sudah lengkap.

**Fase 1 — web publik**
- Adapter OLX/Mamikos/99.co + JSON-LD.
- Config per domain.
- Acceptance: minimal 50 listing publik masuk; detail alamat/luas/fasilitas
  terisi; token AI turun karena data terstruktur.

**Fase 2 — Instagram & Facebook via akun**
- Cookie/session helper + health check.
- Adapter IG hashtag/profile/story dan FB grup/halaman.
- Rate limiter, login-wall detection, cursor.
- Unduh media ke Supabase Storage via signed upload URL.
- **OCR dasar untuk poster/story** (harga + nomor WA). Ini dipindah dari
  Fase 3 karena kontak di IG/FB sering hanya ada di gambar; tanpa OCR,
  listing IG/FB tidak punya kontak yang bisa dijual.
- Runner lokal: `node scripts/run-scraper.mjs --sources=instagram,facebook`
  dijadwalkan lewat Windows Task Scheduler, plus `--dry-run`.
- Akun khusus **belum harus ada** saat pembangunan. Semua kode dan test
  memakai fixture; run nyata baru diaktifkan setelah cookie diisi.
- Acceptance: dry-run menampilkan post IG/FB dari fixture; dengan cookie
  asli, satu run tidak memicu checkpoint; story akun yang di-follow
  terambil; media tersimpan di bucket; kontak dari poster terekstrak.

**Fase 3 — OCR lanjutan & platform lain**
- OCR lanjutan: alamat, fasilitas, dan teks pada poster selain kontak.
- Adapter TikTok/X opsional (pola adapter yang sama).
- Dashboard kualitas data sederhana di respons ingest.

## 8. Risiko & mitigasi

| Risiko | Mitigasi |
|---|---|
| Akun IG/FB kena checkpoint/ban | akun khusus, rate limit ketat, berhenti saat 429, proxy opsional |
| ToS Meta dilanggar | disetujui pemilik produk; akun terpisah; hanya baca |
| Endpoint IG berubah | semua endpoint di satu modul + fixture test |
| Login wall FB | deteksi form login, tandai `login_wall`, jangan retry |
| Foto CDN kedaluwarsa | unduh/OCR saat scrape, simpan teks; URL hanya referensi |
| Duplikat lintas platform | `source_hash` teks + kontak; normalisasi caption |
| Token membengkak | gating + batch + cap per run + log usage |
| Nomor WA bocor ke user gratis | sanitasi `caption`, `raw_text` tidak pernah dikirim |
| Data penipuan | prefilter spam + risk flags valuasi |

## 9. Testing

- Unit test adapter memakai fixture HTML/JSON tersimpan; tidak ada panggilan
  jaringan di test.
- Test `needsAiEnrichment`, `parseListingBatch`, dan batas token.
- Test cursor: post yang sama tidak diproses dua kali.
- Test API: user gratis tidak menerima `source_url`, `contact_wa` penuh,
  atau nomor WA di `caption`.
- Smoke test manual: `node scripts/run-scraper.mjs --dry-run --source=instagram --limit=5`.
- `npm test` harus tetap hijau.

## 10. Yang diserahkan ke builder

- Bentuk akhir selector OLX/Mamikos/99.co (berubah-ubah).
- Detail implementasi rate limiter dan retry.
- Struktur prompt batch dan pemotongan teks.
- Nama kolom final jika migrasi perlu disesuaikan dengan data lama.
- Urutan kota pada config.

## 11. Keputusan pemilik produk

Sudah diputuskan:

1. **Akses Meta:** akun/sesi sendiri, bukan API resmi/Apify.
2. **Runner IG/FB:** PC Windows lokal (IP residensial), bukan GitHub Actions.
   Proxy tidak dipakai kecuali nanti terbukti perlu.
3. **Media:** diunduh ke Supabase Storage (maks 3, ≤1.5MB).
4. **Akun khusus:** belum siap; Fase 2 dibangun lebih dulu dengan fixture dan
   `--dry-run`, lalu diaktifkan setelah cookie tersedia.

Masih perlu disiapkan sebelum Fase 2 *berjalan* (tidak menghambat Fase 0/1):

1. Akun khusus Instagram dan Facebook (disarankan akun baru, bukan pribadi).
2. Akun tersebut sudah join grup FB target dan follow akun IG target.
3. Daftar grup/akun/hashtag per kota.
4. Cookie sesi dimasukkan ke `.env.local` PC lokal.

## 12. Persetujuan

Desain ini butuh persetujuan sebelum implementasi. Setelah disetujui,
langkah berikutnya adalah menulis rencana implementasi teknis
(`writing-plans`) lalu mengeksekusinya per fase.
