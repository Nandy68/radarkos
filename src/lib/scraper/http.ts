/**
 * Fetch teks dengan timeout + retry terbatas.
 */

import type { FetchTextOptions } from "./types";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchText(
  url: string,
  options: FetchTextOptions = {}
): Promise<string | null> {
  const timeoutMs = options.timeoutMs ?? 20_000;
  const retries = options.retries ?? 1;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent": USER_AGENT,
          Accept:
            "text/html,application/xhtml+xml,application/xml,text/xml;q=0.9,*/*;q=0.8",
          ...options.headers,
        },
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (response.ok) return await response.text();
      if (response.status < 500 || attempt === retries) return null;
    } catch {
      if (attempt === retries) return null;
    }

    await wait(1_000);
  }

  return null;
}
