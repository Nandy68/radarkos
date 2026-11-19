# 🛰️ KosRadar External Feeders (Open Source)

Kumpulan skrip penyuplai data kamar kos dari luar untuk membanjiri database KosRadar melalui endpoint aman:
`POST https://radarkos.web.id/api/webhook/ingest`

---

## 1. Google Search & Web Feeder (`google_search_feeder.mjs`)
Mencari listing oper kontrak dan info kos terbaru di Google, Twitter/X, Facebook, dan web publik menggunakan Google Search.

### Cara Pakai:
1. Daftar akun gratis di [serper.dev](https://serper.dev) (mendapatkan **2.500 pencarian Google gratis**).
2. Tambahkan API Key ke file `.env.local`:
   ```env
   SERPER_API_KEY=api_key_serper_anda
   ```
3. Jalankan feeder:
   ```bash
   node scripts/feeder/google_search_feeder.mjs --city=malang
   node scripts/feeder/google_search_feeder.mjs --city=purwokerto
   node scripts/feeder/google_search_feeder.mjs --city=yogyakarta
   ```

---

## 2. Twitter / X Menfess Feeder (`x_menfess_feeder.py`)
Mengekstrak tweet oper kontrak mahasiswa dari akun-akun Menfess kampus ternama (`@unsoedfess`, `@ub_fess`, `@ugm_fess`, `@undipmenfess`) secara gratis tanpa Twitter API resmi.

### Persiapan:
```bash
pip install twikit requests python-dotenv
```

### Cara Pakai:
```bash
python scripts/feeder/x_menfess_feeder.py --city=purwokerto
python scripts/feeder/x_menfess_feeder.py --city=malang
python scripts/feeder/x_menfess_feeder.py --city=yogyakarta
```

---

## 3. Telegram Group Listener (`telegram_group_listener.py`)
Mendengarkan pesan baru secara *real-time* dari grup obrolan mahasiswa (Supergroup / Forum Diskusi Telegram) yang tidak bisa diakses lewat web preview biasa (khususnya untuk wilayah **Yogyakarta & Bandung**).

### Persiapan:
1. Install Telethon:
   ```bash
   pip install telethon requests python-dotenv
   ```
2. Ambil `api_id` dan `api_hash` gratis di [my.telegram.org](https://my.telegram.org) (menu *API development tools*).
3. Masukkan ke `.env.local`:
   ```env
   TELEGRAM_API_ID=12345678
   TELEGRAM_API_HASH=abcdef1234567890abcdef...
   ```

### Cara Pakai:
```bash
python scripts/feeder/telegram_group_listener.py --city=yogyakarta
```
*(Saat pertama kali jalan, masukkan nomor HP untuk login Telegram sekali saja. Setelah itu script akan standby dan otomatis mengirim pesan kos ke KosRadar setiap kali ada yang posting di grup!)*
