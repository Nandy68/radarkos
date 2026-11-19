/**
 * Registry collector aktif. Adapter yang belum tersedia di-skip.
 */

import type { Collector, CollectorKey } from "../types";
import { telegramCollector } from "./telegram";

const REGISTRY: Partial<Record<CollectorKey, Collector>> = {
  telegram: telegramCollector,
};

export function createCollectors(keys: CollectorKey[]): Collector[] {
  return keys.flatMap((key) => (REGISTRY[key] ? [REGISTRY[key]!] : []));
}
