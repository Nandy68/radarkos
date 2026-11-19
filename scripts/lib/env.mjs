/**
 * Membaca secret ingest dari environment.
 * Tidak boleh ada nilai fallback hardcoded — repo ini publik.
 */
export function resolveCronSecret(env = process.env) {
  const secret = (env.CRON_SECRET || env.INGEST_SECRET_KEY || "").trim();
  if (!secret) {
    throw new Error("CRON_SECRET wajib diisi (jangan hardcode di repo).");
  }
  return secret;
}
