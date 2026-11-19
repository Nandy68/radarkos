"""
KosRadar — Twitter / X Menfess Feeder (Python)

Mengekstrak tweet oper kontrak & info kos dari akun-akun Menfess kampus:
- @unsoedfess (Purwokerto)
- @ub_fess / @infoub (Malang)
- @ugm_fess / @uny_fess (Yogyakarta)
- @undipmenfess (Semarang)
- @itbmenfess / @unpad (Bandung)

Menggunakan library open-source `twikit` (tanpa API Key resmi Twitter yang berbayar).
Hasil otomatis dikirim ke webhook KosRadar: POST /api/webhook/ingest

Instalasi:
  pip install twikit requests python-dotenv

Penggunaan:
  python scripts/feeder/x_menfess_feeder.py --city=malang
  python scripts/feeder/x_menfess_feeder.py --city=purwokerto
"""

import sys
import os
import json
import asyncio
import argparse
from pathlib import Path

try:
    import requests
except ImportError:
    print("Modul 'requests' belum terinstall. Jalankan: pip install requests")
    sys.exit(1)

# Baca .env.local
def load_env():
    env_file = Path(__file__).resolve().parent.parent.parent / ".env.local"
    if env_file.exists():
        with open(env_file, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    v = v.strip().strip('"').strip("'")
                    if k not in os.environ:
                        os.environ[k] = v

load_env()

KOSRADAR_URL = os.environ.get("NEXT_PUBLIC_BASE_URL", "https://radarkos.web.id")
INGEST_SECRET = os.environ.get("CRON_SECRET", os.environ.get("INGEST_SECRET_KEY", ""))

MENFESS_ACCOUNTS = {
    "purwokerto": ["unsoedfess"],
    "malang": ["ub_fess", "infoub"],
    "yogyakarta": ["ugm_fess", "uny_fess"],
    "semarang": ["undipmenfess"],
    "solo": ["unsfess"],
    "bandung": ["itbmenfess"]
}

KEYWORDS = ["kos", "kost", "oper kontrak", "over kontrak", "take over", "sewa", "kamar"]

def send_to_kosradar(posts):
    if not posts:
        print("[feeder] Tidak ada postingan yang perlu dikirim.")
        return

    url = f"{KOSRADAR_URL}/api/webhook/ingest"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {INGEST_SECRET}"
    }

    print(f"\n🚀 Mengirim {len(posts)} tweet ke KosRadar ({url})...")
    try:
        res = requests.post(url, json={"posts": posts}, headers=headers, timeout=30)
        data = res.json()
        print("✅ Hasil Ingest:", json.dumps(data.get("stats", data), indent=2))
    except Exception as e:
        print("❌ Gagal mengirim ke webhook:", str(e))

async def scrape_with_twikit(city_slug):
    try:
        from twikit import Client
    except ImportError:
        print("\n⚠️  Library 'twikit' belum terpasang.")
        print("   Jalankan: pip install twikit")
        print("   Atau gunakan feeder Google Search: node scripts/feeder/google_search_feeder.mjs\n")
        return []

    accounts = MENFESS_ACCOUNTS.get(city_slug, [])
    if not accounts:
        print(f"Tidak ada akun menfess terdaftar untuk kota {city_slug}")
        return []

    client = Client(language="id-ID")
    posts = []

    print(f"🔎 Mengambil tweet menfess untuk kota: {city_slug}...")
    for acc in accounts:
        print(f"  -> Mengecek @{acc}...")
        try:
            # Cari tweet yang mengandung kata kunci kos dari user tersebut
            query = f"from:{acc} (kos OR kost OR \"oper kontrak\")"
            tweets = await client.search_tweet(query, "Latest", count=15)
            for t in tweets:
                text = t.text
                if not any(k in text.lower() for k in KEYWORDS):
                    continue

                posts.append({
                    "platform": "twitter_x",
                    "city_slug": city_slug,
                    "raw_text": text,
                    "source_url": f"https://x.com/{acc}/status/{t.id}",
                    "source_name": f"@{acc}",
                    "image_urls": [m.media_url_https for m in getattr(t, "media", []) if hasattr(m, "media_url_https")]
                })
        except Exception as e:
            print(f"     Gagal mengambil dari @{acc}: {e}")

    return posts

def main():
    parser = argparse.ArgumentParser(description="KosRadar X Menfess Feeder")
    parser.add_argument("--city", default="malang", help="Slug kota (malang, purwokerto, yogyakarta, semarang, solo)")
    args = parser.parse_args()

    posts = asyncio.run(scrape_with_twikit(args.city))
    if posts:
        send_to_kosradar(posts)

if __name__ == "__main__":
    main()
