/**
 * Batas anggaran token AI per HTTP ingest batch.
 * Nilai dapat di-override lewat environment; default mengikuti spesifikasi.
 */

export interface AiLimits {
  maxCharsPerPost: number;
  maxPostsPerRun: number;
  maxCallsPerRun: number;
  batchSize: number;
}

const DEFAULT_BATCH_SIZE = 8;

function readInt(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: number
): number {
  const raw = env[key];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getAiLimits(env: NodeJS.ProcessEnv = process.env): AiLimits {
  return {
    maxCharsPerPost: readInt(env, "AI_MAX_CHARS_PER_POST", 700),
    maxPostsPerRun: readInt(env, "AI_MAX_POSTS_PER_RUN", 40),
    maxCallsPerRun: readInt(env, "AI_MAX_CALLS_PER_RUN", 8),
    batchSize: DEFAULT_BATCH_SIZE,
  };
}
