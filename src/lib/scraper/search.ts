/**
 * Helper fallback pencarian: Nitter RSS, Serper, Apify.
 */

import type { RawPost, SourcePlatform } from "@/lib/radar/types";

export interface SerperOrganic {
  title?: string;
  link?: string;
  snippet?: string;
}

export interface SearchPostArgs {
  citySlug: string;
  platform: SourcePlatform;
  sourceName: string;
}

function decodeXml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripCdata(value: string): string {
  return value
    .replace(/^\s*<!\[CDATA\[/, "")
    .replace(/\]\]>\s*$/, "")
    .trim();
}

function extractTag(block: string, tag: string): string {
  const match = block.match(
    new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i")
  );
  return match ? stripCdata(match[1]) : "";
}

export interface NitterItem {
  title: string;
  description: string;
  link: string;
  pubDate: string;
}

export function parseNitterRss(xml: string): NitterItem[] {
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map(
    (match) => match[1]
  );

  return items
    .map((item) => ({
      title: decodeXml(extractTag(item, "title").replace(/<[^>]+>/g, " ")).trim(),
      description: decodeXml(
        extractTag(item, "description").replace(/<[^>]+>/g, " ")
      )
        .replace(/\s+/g, " ")
        .trim(),
      link: extractTag(item, "link"),
      pubDate: extractTag(item, "pubDate"),
    }))
    .filter((item) => item.title.length > 0 || item.description.length > 0);
}

export async function serperSearch(
  query: string,
  limit: number,
  env: NodeJS.ProcessEnv
): Promise<SerperOrganic[]> {
  const apiKey = env.SERPER_API_KEY;
  if (!apiKey) return [];

  try {
    const response = await fetch("https://google.serper.dev/search", {
      method: "POST",
      headers: {
        "X-API-KEY": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ q: query, num: Math.min(20, limit) }),
      signal: AbortSignal.timeout(20_000),
    });

    if (!response.ok) return [];
    const data = (await response.json()) as { organic?: SerperOrganic[] };
    return (data.organic ?? []).slice(0, limit);
  } catch {
    return [];
  }
}

export function mapSearchResults(
  results: SerperOrganic[],
  args: SearchPostArgs
): RawPost[] {
  return results.flatMap((result) => {
    const text = [result.title, result.snippet]
      .filter((value): value is string => Boolean(value))
      .join("\n")
      .trim();

    if (text.length < 20 || !result.link) return [];

    return [
      {
        raw_text: text,
        caption: text,
        source_url: result.link,
        city_slug: args.citySlug,
        platform: args.platform,
        source_name: args.sourceName,
      },
    ];
  });
}

export async function runApifyActor(
  actorId: string,
  input: Record<string, unknown>,
  env: NodeJS.ProcessEnv
): Promise<unknown[]> {
  const token = env.APIFY_TOKEN;
  if (!token || !actorId) return [];

  try {
    const response = await fetch(
      `https://api.apify.com/v2/acts/${encodeURIComponent(actorId)}/run-sync-get-dataset-items?token=${encodeURIComponent(token)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(45_000),
      }
    );

    if (!response.ok) return [];
    const data: unknown = await response.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export function mapApifyItems(
  items: unknown[],
  args: SearchPostArgs
): RawPost[] {
  return items.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const item = raw as Record<string, unknown>;

    const text = String(
      item.text ?? item.caption ?? item.message ?? item.title ?? ""
    ).trim();
    if (text.length < 20) return [];

    const url =
      typeof item.url === "string"
        ? item.url
        : typeof item.postUrl === "string"
        ? item.postUrl
        : typeof item.link === "string"
        ? item.link
        : undefined;

    const timestamp =
      typeof item.timestamp === "string"
        ? item.timestamp
        : typeof item.time === "string"
        ? item.time
        : undefined;

    const imageUrl =
      typeof item.displayUrl === "string"
        ? item.displayUrl
        : typeof item.image === "string"
        ? item.image
        : undefined;

    return [
      {
        raw_text: text,
        caption: text,
        source_url: url,
        posted_at_source: timestamp,
        image_urls: imageUrl ? [imageUrl] : [],
        city_slug: args.citySlug,
        platform: args.platform,
        source_name: args.sourceName,
      },
    ];
  });
}

export function detectLoginWall(html: string): boolean {
  return /log\s*in\s*to\s*facebook|login_form|checkpoint_required|please\s+log\s+in/i.test(
    html
  );
}
