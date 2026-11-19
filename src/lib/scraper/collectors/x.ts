/**
 * Collector X/Twitter. Urutan fallback: Nitter RSS -> Serper -> Apify.
 */

import type { RawPost } from "@/lib/radar/types";
import { CITIES, buildSearchQueries } from "../config";
import {
  mapApifyItems,
  mapSearchResults,
  parseNitterRss,
  runApifyActor,
  serperSearch,
  type SerperOrganic,
} from "../search";
import type { Collector, CollectorContext } from "../types";

function mapNitterPosts(
  items: ReturnType<typeof parseNitterRss>,
  citySlug: string,
  limit: number
): RawPost[] {
  return items
    .flatMap((item) => {
      const text = [item.title, item.description]
        .filter(Boolean)
        .join("\n")
        .trim();
      if (text.length < 20 || !item.link) return [];

      return [
        {
          raw_text: text,
          caption: text,
          source_url: item.link,
          posted_at_source: item.pubDate || undefined,
          city_slug: citySlug,
          platform: "x_menfess" as const,
          source_name: "nitter",
        },
      ];
    })
    .slice(0, limit);
}

export const xCollector: Collector = {
  key: "twitter_x",
  async collect(ctx: CollectorContext): Promise<RawPost[]> {
    const city = CITIES[ctx.citySlug];
    const bases = (ctx.env.NITTER_BASE_URL || "")
      .split(",")
      .map((value) => value.trim().replace(/\/$/, ""))
      .filter(Boolean);

    if (city && bases.length > 0) {
      const nitterQuery = `kos ${city.name} OR "oper kontrak"`;
      for (const base of bases.slice(0, 3)) {
        const xml = await ctx.fetchText(
          `${base}/search/rss?f=tweets&q=${encodeURIComponent(nitterQuery)}`
        );
        if (!xml) continue;
        const posts = mapNitterPosts(
          parseNitterRss(xml),
          ctx.citySlug,
          ctx.limit
        );
        if (posts.length > 0) return posts;
      }
    }

    const queries = buildSearchQueries(ctx.citySlug, "twitter_x");
    const results: SerperOrganic[] = [];
    for (const query of queries.slice(0, 3)) {
      results.push(
        ...(await serperSearch(query, Math.ceil(ctx.limit / 3), ctx.env))
      );
    }
    const searched = mapSearchResults(results, {
      citySlug: ctx.citySlug,
      platform: "x_menfess",
      sourceName: "search:x",
    });
    if (searched.length > 0) return searched.slice(0, ctx.limit);

    const items = await runApifyActor(
      ctx.env.APIFY_X_ACTOR_ID || "",
      { searchQueries: queries.slice(0, 3), maxItems: ctx.limit },
      ctx.env
    );
    return mapApifyItems(items, {
      citySlug: ctx.citySlug,
      platform: "x_menfess",
      sourceName: "apify:x",
    }).slice(0, ctx.limit);
  },
};
