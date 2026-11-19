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
