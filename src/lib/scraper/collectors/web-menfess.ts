/**
 * Collector web menfess / halaman publik umum via Serper.
 */

import type { RawPost } from "@/lib/radar/types";
import { buildSearchQueries } from "../config";
import { mapSearchResults, serperSearch } from "../search";
import type { Collector, CollectorContext } from "../types";

export const webMenfessCollector: Collector = {
  key: "web_menfess",
  async collect(ctx: CollectorContext): Promise<RawPost[]> {
    const queries = buildSearchQueries(ctx.citySlug, "web_menfess");
    const results = [];

    for (const query of queries.slice(0, 4)) {
      results.push(
        ...(await serperSearch(query, Math.ceil(ctx.limit / 4), ctx.env))
      );
    }

    return mapSearchResults(results, {
      citySlug: ctx.citySlug,
      platform: "web_public",
      sourceName: "search:web",
    }).slice(0, ctx.limit);
  },
};
