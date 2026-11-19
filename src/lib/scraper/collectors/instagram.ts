/**
 * Collector Instagram. Tanpa login: Apify -> Serper.
 */

import type { RawPost } from "@/lib/radar/types";
import { buildSearchQueries, CITIES } from "../config";
import {
  mapApifyItems,
  mapSearchResults,
  runApifyActor,
  serperSearch,
} from "../search";
import type { Collector, CollectorContext } from "../types";

export const instagramCollector: Collector = {
  key: "instagram",
  async collect(ctx: CollectorContext): Promise<RawPost[]> {
    const city = CITIES[ctx.citySlug];
    const hashtags = city
      ? [`kos${city.name.toLowerCase().replace(/\s+/g, "")}`, "infokos"]
      : ["infokos"];

    const items = await runApifyActor(
      ctx.env.APIFY_INSTAGRAM_ACTOR_ID || "",
      { hashtags, resultsLimit: ctx.limit },
      ctx.env
    );
    const apified = mapApifyItems(items, {
      citySlug: ctx.citySlug,
      platform: "instagram",
      sourceName: "apify:instagram",
    });
    if (apified.length > 0) return apified.slice(0, ctx.limit);

    const queries = buildSearchQueries(ctx.citySlug, "instagram");
    const results = [];
    for (const query of queries.slice(0, 3)) {
      results.push(
        ...(await serperSearch(query, Math.ceil(ctx.limit / 3), ctx.env))
      );
    }

    return mapSearchResults(results, {
      citySlug: ctx.citySlug,
      platform: "instagram",
      sourceName: "search:instagram",
    }).slice(0, ctx.limit);
  },
};
