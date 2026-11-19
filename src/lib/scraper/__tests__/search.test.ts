import { describe, expect, it } from "vitest";
import {
  detectLoginWall,
  mapSearchResults,
  parseNitterRss,
} from "@/lib/scraper/search";

const RSS = `<rss><channel>
<item>
  <title>Kos putri murah Lowokwaru</title>
  <description><![CDATA[<p>Kos putri Lowokwaru 800rb/bln. WA 081234567890</p>]]></description>
  <link>https://nitter.net/infokosmalang/status/1</link>
  <pubDate>Wed, 18 Nov 2026 10:00:00 GMT</pubDate>
</item>
<item>
  <title>Oper kontrak dekat UB</title>
  <description><![CDATA[2,4jt sisa 5 bulan. Hubungi 081234567890]]></description>
  <link>https://nitter.net/infokosmalang/status/2</link>
</item>
</channel></rss>`;

describe("parseNitterRss", () => {
  it("membaca item RSS dan membersihkan HTML", () => {
    const items = parseNitterRss(RSS);

    expect(items).toHaveLength(2);
    expect(items[0].title).toBe("Kos putri murah Lowokwaru");
    expect(items[0].description).toContain("800rb/bln");
    expect(items[0].description).not.toContain("<p>");
    expect(items[0].link).toBe("https://nitter.net/infokosmalang/status/1");
  });
});

describe("mapSearchResults", () => {
  it("mengubah hasil pencarian menjadi RawPost", () => {
    const posts = mapSearchResults(
      [
        {
          title: "Kos putri Malang",
          link: "https://x.com/infokos/status/1",
          snippet: "800rb/bulan dekat UB",
        },
      ],
      { citySlug: "malang", platform: "x_menfess", sourceName: "search:x" }
    );

    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({
      city_slug: "malang",
      platform: "x_menfess",
      source_url: "https://x.com/infokos/status/1",
      source_name: "search:x",
    });
    expect(posts[0].raw_text).toContain("800rb");
  });
});

describe("detectLoginWall", () => {
  it("mendeteksi halaman login Facebook", () => {
    expect(detectLoginWall("<form>Log in to Facebook</form>")).toBe(true);
    expect(detectLoginWall("checkpoint_required")).toBe(true);
    expect(detectLoginWall("<div>Kos putri murah</div>")).toBe(false);
  });
});
