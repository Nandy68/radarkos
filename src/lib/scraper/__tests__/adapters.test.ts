import { describe, expect, it } from "vitest";
import { facebookCollector } from "@/lib/scraper/collectors/facebook";
import { instagramCollector } from "@/lib/scraper/collectors/instagram";
import { webMenfessCollector } from "@/lib/scraper/collectors/web-menfess";
import { xCollector } from "@/lib/scraper/collectors/x";
import type { CollectorContext } from "@/lib/scraper/types";

function context(
  env: Record<string, string>,
  fetchText: CollectorContext["fetchText"] = async () => null
): CollectorContext {
  return {
    citySlug: "malang",
    limit: 20,
    env: env as unknown as NodeJS.ProcessEnv,
    fetchText,
  };
}

describe("collector tanpa key", () => {
  it("X mengembalikan array kosong, bukan error", async () => {
    await expect(xCollector.collect(context({}))).resolves.toEqual([]);
  });

  it("Instagram mengembalikan array kosong, bukan error", async () => {
    await expect(instagramCollector.collect(context({}))).resolves.toEqual([]);
  });

  it("web menfess mengembalikan array kosong, bukan error", async () => {
    await expect(webMenfessCollector.collect(context({}))).resolves.toEqual([]);
  });
});

describe("facebookCollector", () => {
  it("mempertahankan lebih dari satu post per grup", async () => {
    const html = `
      <div class="story_body_container">Kos putri murah 800rb/bulan dekat UB. WA 081234567890 <a href="/groups/123/posts/111">permalink</a></div>
      <div class="story_body_container">Kos putra 700rb/bulan WiFi. WA 081234567890 <a href="/groups/123/posts/222">permalink</a></div>
    `;

    const posts = await facebookCollector.collect(
      context(
        { FACEBOOK_GROUPS: "123", FB_COOKIE: "c_user=1" },
        async () => html
      )
    );

    expect(posts).toHaveLength(2);
    expect(new Set(posts.map((post) => post.source_url)).size).toBe(2);
  });

  it("berhenti saat kena login wall", async () => {
    const posts = await facebookCollector.collect(
      context(
        { FACEBOOK_GROUPS: "123456", FB_COOKIE: "c_user=1" },
        async () => "<form>Log in to Facebook</form>"
      )
    );

    expect(posts).toEqual([]);
  });
});
