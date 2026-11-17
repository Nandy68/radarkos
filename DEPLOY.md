# Panduan Deployment KosRadar

Dokumen ini menjelaskan langkah-langkah deployment produksi untuk KosRadar: konfigurasi database, deployment ke Vercel, penjadwalan scraping gratis via GitHub Actions, serta cara menghubungkan Hermes Agent dari PC Windows lokal.

---

## 1. Persiapan Database (Supabase)

1. Buat project baru di [Supabase](https://supabase.com).
2. Buka **SQL Editor** pada dashboard Supabase.
3. Jalankan seluruh isi file [`supabase/schema.sql`](supabase/schema.sql):
   - Membuat tabel: `cities`, `listings`, `subscriptions`, `referrals`, `raw_sources`.
   - Membuat composite index performa tinggi:
     ```sql
     CREATE INDEX IF NOT EXISTS listings_city_posted_idx 
     ON listings(city_id, posted_at DESC);
     ```
   - Seed data default untuk kota Purwokerto (`purwokerto`), Semarang, Yogyakarta, Malang, Solo.
4. Salin kredensial dari **Project Settings -> API**:
   - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role secret` key → `SUPABASE_SERVICE_ROLE_KEY` *(Jaga kerahasiaannya!)*

---

## 2. Persiapan Pembayaran (Midtrans)

1. Daftar akun di [Midtrans Console](https://dashboard.midtrans.com) (gunakan Sandbox untuk uji coba, Production untuk rilis).
2. Ambil kunci di menu **Settings -> Access Keys**:
   - `Server Key` → `MIDTRANS_SERVER_KEY`
   - `Client Key` → `NEXT_PUBLIC_MIDTRANS_CLIENT_KEY`
3. Atur **Payment Notification URL** di menu **Settings -> Configuration**:
   - Masukkan: `https://<domain-anda>/api/payment/webhook`
   - Midtrans akan mengirimkan event settlement/capture ke endpoint ini untuk mengaktifkan langganan 14 hari secara instan.

---

## 3. Deployment ke Vercel

### A. Deploy via Vercel Dashboard
1. Push repository KosRadar ke GitHub.
2. Buka [Vercel Dashboard](https://vercel.com) lalu klik **Add New... -> Project**.
3. Import repository `kosradar`.
4. Framework Preset: **Next.js** (terdeteksi otomatis).
5. Pada bagian **Environment Variables**, masukkan seluruh variabel berikut (lihat panduan lengkap di [`.env.example`](.env.example)):

| Key | Deskripsi |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | URL project Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public anon key Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key Supabase (server-only) |
| `DEEPSEEK_API_KEY` | API Key dari [platform.deepseek.com](https://platform.deepseek.com/api_keys) — parser memakai model `deepseek-chat` |
| `DEEPSEEK_MODEL` | *(Opsional)* Override model DeepSeek, default `deepseek-chat` |
| `DEEPSEEK_BASE_URL` | *(Opsional)* Override base URL, default `https://api.deepseek.com/v1` |
| `CRON_SECRET` | Token acak pengaman endpoint `/api/cron/ingest` |
| `INGEST_SECRET_KEY` | Token pengaman webhook `/api/webhook/ingest` untuk Hermes Agent |
| `MIDTRANS_SERVER_KEY` | Server Key Midtrans |
| `NEXT_PUBLIC_MIDTRANS_CLIENT_KEY` | Client Key Midtrans Snap |
| `MIDTRANS_IS_PRODUCTION` | `false` (Sandbox) atau `true` (Production) |
| `WA_GATEWAY_URL` | *(Opsional)* URL webhook gateway WhatsApp (Fonnte / Waha / Baileys) |
| `WA_GATEWAY_TOKEN` | *(Opsional)* API token provider WhatsApp gateway |

6. Klik **Deploy**.
7. Setelah selesai, catat domain produksi Vercel Anda (misal `https://kosradar.vercel.app`).

---

## 4. GitHub Actions Cron 24/7 (Gratis & Otomatis)

KosRadar dilengkapi template workflow GitHub Actions di [`.github/workflows/scraper-cron.yml`](.github/workflows/scraper-cron.yml) yang memicu sinkronisasi scraping setiap 30 menit tanpa perlu server VPS tambahan.

### Cara Mengaktifkan:
1. Buka repository GitHub proyek Anda.
2. Masuk ke **Settings -> Secrets and variables -> Actions -> New repository secret**.
3. Tambahkan 2 secrets:
   - `KOSRADAR_URL`: URL aplikasi Vercel Anda (misal `https://kosradar.vercel.app` tanpa garis miring di akhir).
   - `CRON_SECRET`: Nilai token yang sama dengan `CRON_SECRET` pada environment Vercel.
4. Buka tab **Actions** di GitHub, pilih **KosRadar 24/7 Ingestion Cron**, lalu klik **Run workflow** untuk menguji eksekusi pertama kali.

---

## 5. Menghubungkan Hermes Agent dari PC Windows Lokal (Opsional)

Jika Anda memiliki Hermes Agent (atau script scraper lokal berbasis Playwright/Puppeteer/Selenium) yang membaca grup Facebook Kos, Telegram, atau OLX dari PC Windows lokal, Anda dapat mengirim postingan langsung ke backend KosRadar melalui endpoint `/api/webhook/ingest`.

### Spesifikasi Endpoint
- **Method:** `POST`
- **URL:** `https://<domain-anda>/api/webhook/ingest`
- **Headers:**
  - `Content-Type: application/json`
  - `x-ingest-key: <INGEST_SECRET_KEY>`
- **Payload Schema:**
  ```json
  {
    "city_slug": "purwokerto",
    "raw_text": "Kost Putri Melati dekat Unsoed Grendeng. Fasilitas KM Dalam, kasur, wifi, listrik token. 650rb/bln. WA 081234567890",
    "image_urls": [
      "https://images.unsplash.com/photo-1522771739844-6a9f6d5f14af"
    ],
    "source_url": "https://facebook.com/groups/infokospurwokerto/posts/12345678"
  }
  ```

### Contoh Script PowerShell (Windows)
Simpan file ini sebagai `hermes-push.ps1` pada PC Anda:
```powershell
$domain = "https://kosradar.vercel.app"
$ingestKey = "RAHASIA_INGEST_KEY_ANDA"

$body = @{
    city_slug  = "purwokerto"
    raw_text   = "Oper kontrak kos putra dkt kampus unsoed, sisa 4 bulan 2jt bersih. Km dalam wa 085712345678"
    image_urls = @("https://example.com/foto-kamar.jpg")
    source_url = "https://facebook.com/groups/kos-purwokerto/permalink/99999"
} | ConvertTo-Json -Depth 3

$headers = @{
    "Content-Type" = "application/json"
    "x-ingest-key" = $ingestKey
}

$response = Invoke-RestMethod -Uri "$domain/api/webhook/ingest" -Method Post -Headers $headers -Body $body
$response | Format-List
```

### Contoh Script Python
Simpan file ini sebagai `hermes_push.py`:
```python
import requests

API_URL = "https://kosradar.vercel.app/api/webhook/ingest"
INGEST_KEY = "RAHASIA_INGEST_KEY_ANDA"

payload = {
    "city_slug": "purwokerto",
    "raw_text": "Kos Putri Unsoed AC, WiFi, KM Dalam. Harga Rp850.000/bulan. Hubungi WA 081234567890",
    "image_urls": ["https://example.com/foto1.jpg"],
    "source_url": "https://t.me/infokosunsoed/1234"
}

headers = {
    "Content-Type": "application/json",
    "x-ingest-key": INGEST_KEY
}

resp = requests.post(API_URL, json=payload, headers=headers, timeout=30)
print("Status:", resp.status_code)
print("Response:", resp.json())
```

---

## 6. Verifikasi & Checklist Pra-Rilis

- [x] **Secret Keys:** Semua token rahasia (`SUPABASE_SERVICE_ROLE_KEY`, `MIDTRANS_SERVER_KEY`, `DEEPSEEK_API_KEY`, `INGEST_SECRET_KEY`) hanya berjalan di API server side.
- [x] **Bandwidth Aman:** Komponen `<Image>` menggunakan atribut `unoptimized`, sehingga browser memuat foto langsung dari URL sumber CDN asli tanpa membebani kuota image optimization Vercel.
- [x] **Database Index:** Index `(city_id, posted_at DESC)` terpasang untuk query cepat berkapasitas jutaan baris.
- [x] **TypeScript & ESLint:** `npm run build` dan `npm run lint` selesai dengan 0 error dan 0 warning.
- [x] **Unit Testing:** 74 unit test lolos menguji pre-filter Regex, deduplikasi SHA-256, ekstraksi AI Vikey, WhatsApp negotiator, dan alert dispatcher.
