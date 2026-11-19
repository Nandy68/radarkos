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

const DEFAULT_COLLECTOR_TIMEOUT_MS = 25_000;

function withTimeout<T>(
  task: Promise<T>,
  timeoutMs: number,
  key: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${key} timeout after ${timeoutMs}ms`)),
      timeoutMs
    );
  });

  return Promise.race([task, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export async function collectAllSources(
  collectors: Collector[],
  ctx: CollectorContext
): Promise<CollectResult> {
  const timeoutMs = ctx.timeoutMs ?? DEFAULT_COLLECTOR_TIMEOUT_MS;
  const settled = await Promise.allSettled(
    collectors.map((collector) =>
      withTimeout(collector.collect(ctx), timeoutMs, collector.key)
    )
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
