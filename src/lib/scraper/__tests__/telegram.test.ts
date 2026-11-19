import { describe, expect, it } from "vitest";
import { parseTelegramHtml } from "@/lib/scraper/collectors/telegram";

const FIXTURE = `
<div class="tgme_widget_message_wrap js-widget_message_wrap">
  <div class="tgme_widget_message">
    <a class="tgme_widget_message_date" href="https://t.me/infokosmalang/123">
      <time datetime="2026-11-18T10:00:00+00:00">18 Nov</time>
    </a>
    <div class="tgme_widget_message_text js-message_text" dir="auto">Kos putri Grendeng 800rb/bln, AC, WiFi, KM dalam. WA 081234567890</div>
    <a class="tgme_widget_message_photo_wrap" style="background-image:url('https://cdn.example.com/photo.jpg')"></a>
    <a class="tgme_widget_message_photo_wrap" style="background-image:url('https://telegram.org/img/emoji/1.svg')"></a>
  </div>
</div>
<div class="tgme_widget_message_wrap js-widget_message_wrap">
  <div class="tgme_widget_message">
    <a class="tgme_widget_message_date" href="https://t.me/infokosmalang/124">
      <time datetime="2026-11-18T11:00:00+00:00">18 Nov</time>
    </a>
    <div class="tgme_widget_message_text js-message_text" dir="auto">Promo pinjaman online cepat cair</div>
  </div>
</div>
`;

describe("parseTelegramHtml", () => {
  it("mengambil post kos dengan metadata sumber", () => {
    const posts = parseTelegramHtml(FIXTURE, {
      channel: "infokosmalang",
      citySlug: "malang",
      limit: 20,
    });

    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({
      city_slug: "malang",
      platform: "telegram",
      source_name: "@infokosmalang",
      source_url: "https://t.me/infokosmalang/123",
      posted_at_source: "2026-11-18T10:00:00+00:00",
    });
    expect(posts[0].raw_text).toContain("Kos putri");
    expect(posts[0].caption).toBe(posts[0].raw_text);
    expect(posts[0].image_urls).toEqual(["https://cdn.example.com/photo.jpg"]);
  });

  it("menghormati limit", () => {
    const posts = parseTelegramHtml(FIXTURE, {
      channel: "infokosmalang",
      citySlug: "malang",
      limit: 1,
    });

    expect(posts).toHaveLength(1);
  });
});
