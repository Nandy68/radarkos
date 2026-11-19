/**
 * Registry collector aktif. Adapter yang belum tersedia di-skip.
 */

import type { Collector, CollectorKey } from "../types";
import { facebookCollector } from "./facebook";
import { instagramCollector } from "./instagram";
import { telegramCollector } from "./telegram";
import { webMenfessCollector } from "./web-menfess";
import { xCollector } from "./x";

const REGISTRY: Partial<Record<CollectorKey, Collector>> = {
  telegram: telegramCollector,
  twitter_x: xCollector,
  facebook: facebookCollector,
  instagram: instagramCollector,
  web_menfess: webMenfessCollector,
};

export function createCollectors(keys: CollectorKey[]): Collector[] {
  return keys.flatMap((key) => (REGISTRY[key] ? [REGISTRY[key]!] : []));
}
