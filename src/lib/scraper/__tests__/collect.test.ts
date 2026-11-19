import { describe, expect, it } from "vitest";
import { collectAllSources } from "@/lib/scraper/collect";
import type { Collector, CollectorContext } from "@/lib/scraper/types";
import type { RawPost } from "@/lib/radar/types";

function post(text: string, sourceUrl?: string): RawPost {
  return {
    raw_text: text,
    city_slug: "malang",
    platform: "telegram",
    source_url: sourceUrl,
  };
}

const ctx: CollectorContext = {
  citySlug: "malang",
  limit: 20,
  env: {} as NodeJS.ProcessEnv,
  fetchText: async () => null,
};

describe("collectAllSources", () => {
  it("satu collector gagal tidak menjatuhkan yang lain", async () => {
    const collectors: Collector[] = [
      { key: "telegram", collect: async () => [post("kos a")] },
      {
        key: "twitter_x",
        collect: async () => {
          throw new Error("timeout");
        },
      },
    ];

    const result = await collectAllSources(collectors, ctx);

    expect(result.posts).toHaveLength(1);
    expect(result.reports).toEqual([
      { key: "telegram", ok: true, count: 1 },
      { key: "twitter_x", ok: false, count: 0, error: "timeout" },
    ]);
  });

  it("membatasi collector yang menggantung", async () => {
    const result = await collectAllSources(
      [
        {
          key: "telegram",
          collect: () => new Promise(() => {}),
        },
      ],
      { ...ctx, timeoutMs: 20 }
    );

    expect(result.posts).toEqual([]);
    expect(result.reports[0]).toMatchObject({
      key: "telegram",
      ok: false,
      count: 0,
    });
    expect(result.reports[0].error).toMatch(/timeout/i);
  });

  it("membuang duplikat lintas sumber", async () => {
    const collectors: Collector[] = [
      { key: "telegram", collect: async () => [post("kos a", "https://x/1")] },
      { key: "facebook", collect: async () => [post("kos a", "https://x/1")] },
    ];

    const result = await collectAllSources(collectors, ctx);

    expect(result.posts).toHaveLength(1);
    expect(result.reports.map((report) => report.count)).toEqual([1, 0]);
  });
});
