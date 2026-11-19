"""
KosRadar — Telegram Group & Forum Listener (Python + Telethon)

Kanal-kanal publik seperti @infokosmalang bisa di-scrape tanpa login.
Namun grup obrolan mahasiswa Jogja & Bandung umumnya berupa **Supergroup / Forum Tertutup**
yang tidak bisa dibuka di web biasa (redirect 302).

Script ini menggunakan library open-source Telethon (MTProto Telegram API resmi)
untuk mendengarkan postingan kamar kos di grup-grup tersebut, lalu otomatis
mengirimkannya ke Webhook KosRadar: POST /api/webhook/ingest

Instalasi:
  pip install telethon requests python-dotenv

Persiapan:
  1. Dapatkan api_id dan api_hash gratis di https://my.telegram.org (pilih API development tools).
  2. Masukkan ke .env.local:
     TELEGRAM_API_ID=1234567
     TELEGRAM_API_HASH=abcdef123456...
  3. Jalankan script ini, login sekali dengan nomor Telegram Anda.
  4. Script akan mendengarkan pesan baru secara realtime!

Penggunaan:
  python scripts/feeder/telegram_group_listener.py --city=yogyakarta
"""

import sys
import os
import json
import argparse
from pathlib import Path

try:
    import requests
except ImportError:
    print("Jalankan: pip install requests")
    sys.exit(1)

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
API_ID = os.environ.get("TELEGRAM_API_ID")
API_HASH = os.environ.get("TELEGRAM_API_HASH")

KEYWORDS = ["kos", "kost", "oper kontrak", "over kontrak", "take over", "kamar kosong", "sewa kamar"]

def send_to_kosradar(city_slug, text, message_link, group_title):
    url = f"{KOSRADAR_URL}/api/webhook/ingest"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {INGEST_SECRET}"
    }

    payload = {
        "platform": "telegram",
        "city_slug": city_slug,
        "raw_text": text,
        "source_url": message_link,
        "source_name": group_title
    }

    try:
        res = requests.post(url, json=payload, headers=headers, timeout=10)
        print(f"✅ [Terkirim ke KosRadar] {res.status_code}: {text[:60]}...")
    except Exception as e:
        print(f"❌ Gagal mengirim: {e}")

def main():
    try:
        from telethon import TelegramClient, events
    except ImportError:
        print("\n⚠️  Library 'telethon' belum terpasang.")
        print("   Jalankan: pip install telethon")
        return

    if not API_ID or not API_HASH:
        print("\n⚠️  TELEGRAM_API_ID dan TELEGRAM_API_HASH belum diatur di .env.local.")
        print("   Dapatkan gratis di https://my.telegram.org -> API development tools.")
        print("   Masukkan ke .env.local:")
        print("     TELEGRAM_API_ID=...")
        print("     TELEGRAM_API_HASH=...\n")
        return

    parser = argparse.ArgumentParser(description="KosRadar Telegram Group Listener")
    parser.add_argument("--city", default="yogyakarta", help="Slug kota (yogyakarta, bandung, dll)")
    args = parser.parse_args()

    client = TelegramClient("kosradar_session", int(API_ID), API_HASH)

    @client.on(events.NewMessage)
    async def handler(event):
        text = event.raw_text or ""
        lower = text.lower()

        # Cek apakah pesan berkaitan dengan kos
        if any(kw in lower for kw in KEYWORDS):
            chat = await event.get_chat()
            chat_title = getattr(chat, "title", getattr(chat, "username", "Telegram Group"))
            msg_link = f"https://t.me/c/{chat.id}/{event.id}" if hasattr(chat, "id") else None

            print(f"\n📨 [Pesan Kos Baru di {chat_title}]:")
            print(f"   {text[:100]}...")
            send_to_kosradar(args.city, text, msg_link, chat_title)

    print(f"🚀 Telegram Group Listener aktif untuk kota [{args.city}]...")
    print("Mendengarkan semua grup obrolan Anda secara realtime...")
    client.start()
    client.run_until_disconnected()

if __name__ == "__main__":
    main()
