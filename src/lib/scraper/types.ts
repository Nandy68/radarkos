/**
 * Kontrak collector multi-sumber.
 */

import type { RawPost } from "@/lib/radar/types";

export type CollectorKey =
  | "telegram"
  | "twitter_x"
  | "facebook"
  | "instagram"
  | "web_menfess";

export interface FetchTextOptions {
  timeoutMs?: number;
  retries?: number;
  headers?: Record<string, string>;
}

export interface CollectorContext {
  citySlug: string;
  limit: number;
  env: NodeJS.ProcessEnv;
  fetchText: (url: string, options?: FetchTextOptions) => Promise<string | null>;
}

export interface Collector {
  key: CollectorKey;
  collect(ctx: CollectorContext): Promise<RawPost[]>;
}

export interface CollectorReport {
  key: CollectorKey;
  ok: boolean;
  count: number;
  error?: string;
}

export interface CollectResult {
  posts: RawPost[];
  reports: CollectorReport[];
}
