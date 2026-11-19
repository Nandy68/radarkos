/**
 * Collector Facebook. Urutan fallback: mbasic + cookie -> Apify -> Serper.
 */

import type { RawPost } from "@/lib/radar/types";
import { buildSearchQueries } from "../config";
import {
  detectLoginWall,
  mapApifyItems,
  mapSearchResults,
  runApifyActor,
  serperSearch,
} from "../search";
import type { Collector, CollectorContext } from "../types";

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function parseMbasicPosts(html: string): string[] {
  return html
    .split(/story_body_container[^>]*>/i)
    .slice(1)
    .map((chunk) => stripHtml(chunk.split("</div>")[0] ?? chunk))
    .filter((text) => text.length >= 30);
}

export const facebookCollector: Collector = {
  key: "facebook",
  async collect(ctx: CollectorContext): Promise<RawPost[]> {
    const groups = (ctx.env.FACEBOOK_GROUPS || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    const cookie = ctx.env.FB_COOKIE;

    if (groups.length > 0 && cookie) {
      const posts: RawPost[] = [];

      for (const group of groups.slice(0, 3)) {
        const html = await ctx.fetchText(
          `https://mbasic.facebook.com/groups/${encodeURIComponent(group)}`,
          { headers: { cookie } }
        );
        if (!html) continue;
        if (detectLoginWall(html)) {
          console.warn("[scraper] facebook: login wall terdeteksi");
          break;
        }

        for (const text of parseMbasicPosts(html)) {
          if (posts.length >= ctx.limit) break;
          posts.push({
            raw_text: text,
            caption: text,
            source_url: `https://www.facebook.com/groups/${group}`,
            city_slug: ctx.citySlug,
            platform: "facebook_group",
            source_name: `fb:${group}`,
          });
        }
        if (posts.length >= ctx.limit) break;
      }

      if (posts.length > 0) return posts;
    }

    const items = await runApifyActor(
      ctx.env.APIFY_FACEBOOK_ACTOR_ID || "",
      {
        startUrls: groups.map((group) => ({
          url: `https://www.facebook.com/groups/${group}`,
        })),
        resultsLimit: ctx.limit,
      },
      ctx.env
    );
    const apified = mapApifyItems(items, {
      citySlug: ctx.citySlug,
      platform: "facebook_group",
      sourceName: "apify:facebook",
    });
    if (apified.length > 0) return apified.slice(0, ctx.limit);

    const queries = buildSearchQueries(ctx.citySlug, "facebook");
    const results = [];
    for (const query of queries.slice(0, 3)) {
      results.push(
        ...(await serperSearch(query, Math.ceil(ctx.limit / 3), ctx.env))
      );
    }
    return mapSearchResults(results, {
      citySlug: ctx.citySlug,
      platform: "facebook_group",
      sourceName: "search:facebook",
    }).slice(0, ctx.limit);
  },
};
