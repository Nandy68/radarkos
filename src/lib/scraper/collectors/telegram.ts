/**
 * Collector channel Telegram publik via halaman preview t.me/s/<channel>.
 */

import { hasHousingKeyword, isSpam } from "@/lib/radar/prefilter";
import type { RawPost } from "@/lib/radar/types";
import { TELEGRAM_CHANNELS } from "../config";
import type { Collector, CollectorContext } from "../types";

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function cleanHtmlText(html: string): string {
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, "$2 ($1)")
      .replace(/<[^>]+>/g, "")
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export interface ParseTelegramOptions {
  channel: string;
  citySlug: string;
  limit: number;
}

export function parseTelegramHtml(
  html: string,
  options: ParseTelegramOptions
): RawPost[] {
  const blocks = html
    .split('<div class="tgme_widget_message_wrap')
    .slice(1);
  const posts: RawPost[] = [];

  for (const block of blocks) {
    if (posts.length >= options.limit) break;

    const textMatch = block.match(
      /class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/
    );
    if (!textMatch) continue;

    const rawText = cleanHtmlText(textMatch[1]);
    if (
      rawText.length < 30 ||
      !hasHousingKeyword(rawText) ||
      isSpam(rawText)
    ) {
      continue;
    }

    const linkMatch = block.match(
      /class="tgme_widget_message_date"[^>]*href="([^"]+)"/
    );
    const timeMatch = block.match(/datetime="([^"]+)"/);

    const imageUrls: string[] = [];
    for (const match of block.matchAll(/background-image:url\('([^']+)'\)/g)) {
      const url = match[1];
      if (
        url &&
        !imageUrls.includes(url) &&
        !url.includes("/emoji/") &&
        !url.includes("emoji.php") &&
        !url.includes("unsplash.com") &&
        !url.endsWith(".svg")
      ) {
        imageUrls.push(url);
      }
    }

    posts.push({
      raw_text: rawText,
      caption: rawText,
      source_url: linkMatch?.[1] ?? `https://t.me/${options.channel}`,
      posted_at_source: timeMatch?.[1],
      image_urls: imageUrls.slice(0, 4),
      city_slug: options.citySlug,
      platform: "telegram",
      source_name: `@${options.channel}`,
    });
  }

  return posts;
}

export const telegramCollector: Collector = {
  key: "telegram",
  async collect(ctx: CollectorContext): Promise<RawPost[]> {
    const targets = TELEGRAM_CHANNELS.filter(
      (target) =>
        target.is_enabled && target.city_slug === ctx.citySlug
    );
    const posts: RawPost[] = [];

    for (const target of targets) {
      const html = await ctx.fetchText(
        `https://t.me/s/${target.channel}`
      );
      if (!html) {
        console.warn(`[scraper] telegram @${target.channel}: fetch gagal`);
        continue;
      }

      posts.push(
        ...parseTelegramHtml(html, {
          channel: target.channel,
          citySlug: ctx.citySlug,
          limit: ctx.limit,
        })
      );
    }

    return posts;
  },
};
