# KosRadar Deal Valuation Engine

Tujuan mesin ini bukan mencari harga yang paling kecil, tetapi menemukan kamar
yang **harga sewanya lebih rendah dari nilai pasar yang wajar** untuk area, tipe,
fasilitas, dan ukuran kamar yang setara.

Semua perhitungan deterministik, dapat diaudit, dan tidak bergantung pada tebakan
LLM. LLM hanya dipakai untuk ekstraksi; keputusan "murah / bukan" diambil oleh
model statistik di `valuation.ts`.

```
postingan internet
      │
      ▼
prefilter (spam, kata kunci, hash)
      │
      ▼
ekstraksi AI + parser deterministik
      │
      ▼
rekonsiliasi harga (pricing.ts)
      │   rb / ribu / k / jt / juta / Rp
      │   per bulan / tahun / semester / minggu / hari
      │   total oper kontrak ÷ sisa bulan
      │   deposit dipisahkan, nomor HP diabaikan
      ▼
comparables (kota, tipe, area, fasilitas, ukuran, umur)
      │
      ▼
robust weighted median + MAD
      │
      ├── hierarchical shrinkage: area → kota
      ├── koreksi tipe & fasilitas
      ├── ridge hedonic regression (bila data cukup)
      ▼
nilai pasar (fair price), rentang pasar, z-score, confidence
      │
      ▼
risk layer (scam, data bolong, listing basi)
      │
      ▼
deal score 0–100 + grade
      │
      ▼
kurasi feed: hanya below-market yang lolos ambang
```

## 1. Normalisasi harga

`src/lib/radar/pricing.ts`

Contoh yang ditangani:

| Teks | Ekuivalen bulanan |
|---|---|
| `800rb/bulan` | 800.000 |
| `1,2jt per bulan` | 1.200.000 |
| `Rp 1.500.000 / bulan` | 1.500.000 |
| `650 ribu` | 650.000 |
| `2,4jt sisa 5 bulan` | 480.000 |
| `12jt per tahun` | 1.000.000 |
| `800rb + deposit 500rb` | sewa 800.000; deposit 500.000 |

Aturan penting:

- Nomor HP dan ukuran kamar (`3x4 m`) tidak boleh dianggap harga.
- Harga total kontrak dinormalisasi ke ekuivalen bulanan.
- Deposit/uang muka tidak dicampur dengan harga sewa.
- Parser deterministik dibandingkan dengan output LLM. Jika keduanya sama,
  confidence naik. Jika berbeda jauh, harga ditandai `price_conflict` dan
  mesin valuasi menurunkan bobot sinyal tersebut.

## 2. Comparables dan similarity

Setiap listing dibandingkan dengan listing lain di kota yang sama (maksimum 400
listing terbaru, lookback 365 hari).

Bobot pembanding:

```
weight = recency
       × (0.08
        + 0.52 × areaSimilarity
        + 0.18 × facilitySimilarity
        + 0.14 × typeSimilarity
        + 0.08 × sizeSimilarity)
```

- **areaSimilarity** memakai Jaccard + containment dari token area, sehingga
  `Pogung Kidul` cocok dengan `Pogung Kidul (± 400m ke UGM)`.
- **facilitySimilarity** menormalkan fasilitas ke fitur kanonik: AC, KM dalam,
  WiFi, furnitur, parkir, water heater, dapur, laundry, keamanan, utilitas,
  kulkas.
- **recency** memakai half-life 90 hari; listing lama tetap bisa menjadi
  pembanding tetapi bobotnya menurun.
- Listing dengan judul/area/harga identik tidak dihitung dua kali.

## 3. Robust statistics

Harga diubah ke `log(price)` agar distribusi lebih simetris dan perbedaan
persentase konsisten.

- **Weighted median** dipakai sebagai pusat pasar, bukan mean, agar listing
  ekstrem tidak menarik nilai pasar.
- **Weighted MAD** (Median Absolute Deviation) dipakai sebagai skala dispersi:
  `scale = max(0.14, 1.4826 × MAD)`.
- Harga pembanding dikoreksi dulu ke spesifikasi target:
  - rasio tipe (`kos_putra`, `kos_putri`, `kos_campur`, `oper_kontrak`)
  - premium fasilitas (AC, KM dalam, water heater, dan seterusnya)
  - rasio ukuran kamar bila kedua listing menyebut luas
- **Hierarchical shrinkage**: center area yang sempit ditarik ke center kota
  dengan `alpha = areaWeight / (areaWeight + 3)`. Ini mencegah satu area dengan
  dua pembanding menghasilkan nilai pasar yang terlalu yakin.

## 4. Hedonic ridge regression

Jika minimal 8 pembanding tersedia, mesin juga melatih regresi ridge:

```
log(harga) ~ log(ukuran)
           + AC + KM dalam + WiFi + furnitur + parkir
           + water heater + dapur + laundry + keamanan
           + utilitas + kulkas
```

Regularisasi `lambda = max(1.5, n × 0.4)` mencegah overfitting pada data tipis.
Model hanya dipakai bila:

- koefisien bisa diselesaikan,
- R² tertimbang ≥ 0.08,
- prediksi tidak menyimpang lebih dari ±80% dari median robust.

Prediksi hedonic di-blend maksimal 45% dengan median robust. Sisanya tetap
median karena lebih tahan outlier.

## 5. Nilai pasar dan diskon

```
fairPrice = exp(blend(median robust, hedonic))
discount  = (fairPrice - price) / fairPrice × 100
zScore    = (log(price) - logCenter) / robustScale
```

Rentang pasar `market_low` dan `market_high` memakai ±1.28 × skala (sekitar
persentil 10–90), lalu dilebarkan saat sampel masih sedikit.

## 6. Confidence

Confidence 0..1 adalah fungsi dari:

- effective sample size (`(Σw)² / Σw²`),
- stabilitas dispersi (MAD),
- coverage area,
- kelengkapan data listing,
- keyakinan sinyal harga,
- kesegaran listing.

Sampel < 2 pembanding membatasi confidence maksimum 0.35. Prior kota dipakai
sebagai pseudo-observation saat data tipis, tetapi tidak boleh membuat mesin
terlalu yakin.

## 7. Risk layer

Red flag menurunkan skor dan dapat memblokir listing dari feed deal:

| Flag | Dampak |
|---|---|
| tidak ada kontak | +12 |
| tidak ada link sumber | +6 |
| tidak ada foto | +5 |
| area tidak spesifik | +8 |
| harga/periodisitas tidak jelas | +10 |
| pembanding < 2 | +8 |
| listing > 30 / 60 / 120 hari | +6 / +12 / +20 |
| harga < 200rb | +12 |
| z-score < -3.2 | +18 |
| z-score < -4.2 | +12 tambahan |
| diskon > 60% dengan sampel cukup | +10 |
| minta transfer/DP sebelum survey | +30 |
| pemilik di luar kota/negeri | +15 |
| desakan transfer | +15 |
| minta OTP | +40 |

Red flag dengan severity ≥ 30 (mis. transfer sebelum survey) langsung
memblokir grade `steal`/`underpriced`, sekalipun angkanya terlihat sangat murah.

## 8. Deal score dan grade

```
valueScore       = 70 × (1 - exp(-max(discount, 0) / 16))
zBonus           = clamp((-zScore - 0.8) × 2.5, 0, 10)
confidenceScore  = 14 × confidence
freshnessScore   = 8 × exp(-ageDays / 21)
completeness     = 5 × completeness
riskPenalty      = riskScore × 0.55

dealScore = clamp(sum - riskPenalty, 0, 100)
```

Grade:

| Grade | Syarat |
|---|---|
| `steal` | diskon ≥ 25%, confidence ≥ 0.55, risk < 50, tanpa red flag berat |
| `underpriced` | diskon ≥ 12%, confidence ≥ 0.45, risk ≤ 55 |
| `watch` | diskon ≥ 5%, atau kandidat murah yang terblokir red flag |
| `fair` | diskon antara -5% dan 5% |
| `overpriced` | diskon < -5% |
| `unknown` | harga atau pembanding belum cukup |

`is_undervalued = grade ∈ {steal, underpriced}`.

## 9. Kurasi feed

`rankDeals()` menilai seluruh kandidat kota, lalu `curateDeals()`:

1. Jika ada listing `is_undervalued`, feed hanya berisi listing tersebut.
2. Jika tidak ada (cold start / kota baru), feed fallback menampilkan listing
   yang punya nilai pasar, diurutkan berdasarkan deal score.

Filter `type`, `max_price`, `area`, dan `facility` diterapkan **setelah**
valuasi agar baseline pasar tidak berubah karena filter pengguna.

API `/api/listings` mengembalikan:

- `feed_mode`: `deals` atau `fallback`
- `deals_count`
- `market_value`, `discount_pct`, `deal_score`, `deal_confidence`,
  `deal_grade`, `deal_reasons`, `risk_flags`, `sample_size`

## 10. Integrasi ingestion

`src/lib/radar/pipeline.ts` dipakai oleh `/api/cron/ingest` dan
`/api/webhook/ingest`:

1. prefilter + dedup
2. resolve kota
3. ekstraksi AI/heuristik
4. rekonsiliasi harga
5. valuasi terhadap pembanding kota (cache per batch)
6. insert dengan fallback aman bila kolom valuasi belum dimigrasi
7. radar alert WhatsApp dengan diskon dan confidence

Kolom audit disimpan di `listings` (lihat `supabase/schema.sql`):
`market_value`, `discount_pct`, `deal_score`, `deal_confidence`, `deal_grade`,
`deal_reasons`, `risk_flags`, `valuation`, dan field harga terstruktur.

## 11. Tuning

Ambang kebijakan ada di `DEFAULT_DEAL_POLICY`:

```ts
{
  minDiscountPct: 12,
  minConfidence: 0.45,
  maxRiskScore: 55,
  maxComparableAgeDays: 365,
}
```

Semua fungsi menerima override lewat `DealEngineOptions`, sehingga kebijakan bisa
diubah per kota, per kanal, atau saat eksperimen tanpa mengubah algoritma inti.
