import { NextResponse } from "next/server";
import { autoPapaGeorgiaDetailImageCandidates } from "@/lib/catalog/autopapa-georgia-source";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const headers = {
  accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9,ka;q=0.8",
  "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/150 Safari/537.36",
};

function plain(value: string) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function listingContexts(markup: string, base: string) {
  const anchors = [...markup.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
  const matches = anchors
    .map((match) => {
      try {
        const href = new URL(match[1].replace(/&amp;/g, "&"), base).toString();
        const pathname = new URL(href).pathname;
        if (!/^\/en\/usd\/[^/?#]+\/[^/?#]+\/\d{5,}\/?$/i.test(pathname)) return null;
        return { href, anchor: plain(match[2]).slice(0, 160), index: match.index || 0 };
      } catch { return null; }
    })
    .filter((item): item is { href: string; anchor: string; index: number } => Boolean(item));
  const unique = [...new Map(matches.map((item) => [item.href, item])).values()].slice(0, 8);
  return unique.map((item, index) => {
    const next = unique[index + 1]?.index || Math.min(markup.length, item.index + 18_000);
    const start = Math.max(0, item.index - 2_000);
    const end = Math.min(markup.length, Math.max(next, item.index + 7_000));
    const html = markup.slice(start, end);
    const imageUrls = [...html.matchAll(/(?:src|data-src|data-original)=["']([^"']+)["']/gi)]
      .map((match) => { try { return new URL(match[1].replace(/&amp;/g, "&"), base).toString(); } catch { return ""; } })
      .filter((url) => /^https?:/i.test(url) && !/logo|icon|avatar|banner|sprite|placeholder/i.test(url))
      .slice(0, 12);
    return {
      href: item.href,
      anchor: item.anchor,
      context: plain(html).replace(/\+?\d[\d\s()\-]{7,}\d/g, "[phone]").slice(0, 1_200),
      images: [...new Set(imageUrls)],
    };
  });
}

function photoTags(markup: string) {
  return [...markup.matchAll(/<[^>]{0,700}\/system\/car\/photos\/[^>]{0,700}>/gi)]
    .map((match) => match[0].replace(/\s+/g, " ").slice(0, 900))
    .filter((value, index, all) => all.indexOf(value) === index)
    .slice(0, 40);
}

export async function GET() {
  const url = "https://autopapa.ge/en/usd/search?page=1";
  const started = Date.now();
  try {
    const response = await fetch(url, { headers, redirect: "follow", cache: "no-store", signal: AbortSignal.timeout(12_000) });
    const markup = await response.text();
    const cards = listingContexts(markup, response.url || url);
    const detailUrl = cards[0]?.href || "";
    let detail: unknown = null;
    if (detailUrl) {
      try {
        const detailResponse = await fetch(detailUrl, { headers, redirect: "follow", cache: "no-store", signal: AbortSignal.timeout(12_000) });
        const detailMarkup = await detailResponse.text();
        detail = {
          url: detailUrl,
          status: detailResponse.status,
          bytes: Buffer.byteLength(detailMarkup),
          title: plain(detailMarkup.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").slice(0, 180),
          imageCandidates: autoPapaGeorgiaDetailImageCandidates(detailMarkup, detailResponse.url || detailUrl),
          photoTags: photoTags(detailMarkup),
        };
      } catch (detailError) {
        detail = { url: detailUrl, error: String((detailError as Error)?.message || detailError).slice(0, 300) };
      }
    }
    return NextResponse.json({
      runtime: "yandex-serverless",
      status: response.status,
      bytes: Buffer.byteLength(markup),
      ms: Date.now() - started,
      cards,
      detail,
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: String((error as Error)?.message || error), ms: Date.now() - started }, { status: 500 });
  }
}
