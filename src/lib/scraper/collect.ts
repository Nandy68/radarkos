/**
 * Jalankan semua collector sekaligus. Satu gagal, sisanya tetap masuk.
 */

import type { RawPost } from "@/lib/radar/types";
import type {
  CollectResult,
  Collector,
  CollectorContext,
  CollectorReport,
} from "./types";

export async function collectAllSources(
  collectors: Collector[],
  ctx: CollectorContext
): Promise<CollectResult> {
  const settled = await Promise.allSettled(
    collectors.map((collector) => collector.collect(ctx))
  );

  const posts: RawPost[] = [];
  const seen = new Set<string>();

  const reports: CollectorReport[] = collectors.map((collector, index) => {
    const result = settled[index];

    if (result.status === "rejected") {
      const message =
        result.reason instanceof Error
          ? result.reason.message
          : String(result.reason);
      console.warn(`[scraper] ${collector.key} gagal: ${message}`);
      return { key: collector.key, ok: false, count: 0, error: message };
    }

    let count = 0;
    for (const post of result.value ?? []) {
      const dedupKey = post.source_url || post.raw_text;
      if (!dedupKey || seen.has(dedupKey)) continue;
      seen.add(dedupKey);
      posts.push(post);
      count += 1;
    }

    console.log(`[scraper] ${collector.key}: ${count} post`);
    return { key: collector.key, ok: true, count };
  });

  return { posts, reports };
}
