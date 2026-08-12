import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ROUTES = [
  ["myauto-main", "https://www.myauto.ge/en/main"],
  ["myauto-main-no-www", "https://myauto.ge/en/main"],
  ["myauto-api2", "https://api2.myauto.ge/en/products/122857826"],
  ["autopapa-home", "https://autopapa.ge/en/usd"],
  ["autopapa-search", "https://autopapa.ge/en/usd/search?page=1"],
  ["autopapa-export", "https://export.autopapa.ge/"],
  ["autobazroba-home", "https://www.autobazroba.com/"],
] as const;

const headers = {
  accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9,ka;q=0.8",
  "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/150 Safari/537.36",
};

function linksFromHtml(text: string, base: string) {
  const links: string[] = [];
  for (const match of text.matchAll(/href=["']([^"']+)["']/gi)) {
    try {
      const url = new URL(match[1].replace(/&amp;/g, "&"), base).toString();
      if (/myauto\.ge/i.test(base) && /\/en\/pr\/\d+/i.test(url)) links.push(url);
      if (/autopapa\.ge/i.test(base) && /\/(?:en\/)?(?:usd\/)?(?:search\/)?(?:car|cars|vehicle|vehicles|auto|detail|stock|lot|offer|listing)?[^?#]*\d{3,}/i.test(new URL(url).pathname)) links.push(url);
    } catch { /* ignore malformed href */ }
  }
  return [...new Set(links)].slice(0, 24);
}

function imageHosts(text: string, base: string) {
  const hosts: string[] = [];
  for (const match of text.matchAll(/(?:src|data-src|data-original|content)=["']([^"']+)["']/gi)) {
    try {
      const url = new URL(match[1].replace(/&amp;/g, "&"), base);
      if (/\.(?:jpe?g|png|webp|avif)(?:$|\?)/i.test(url.pathname + url.search)) hosts.push(url.host);
    } catch { /* ignore */ }
  }
  return [...new Set(hosts)].slice(0, 16);
}

export async function GET() {
  const startedAt = Date.now();
  const results = [];
  for (const [name, url] of ROUTES) {
    const started = Date.now();
    try {
      const response = await fetch(url, {
        headers,
        redirect: "follow",
        cache: "no-store",
        signal: AbortSignal.timeout(8_000),
      });
      const text = await response.text();
      results.push({
        name,
        status: response.status,
        finalHost: new URL(response.url || url).host,
        bytes: Buffer.byteLength(text),
        ms: Date.now() - started,
        challenge: /just a moment|cf-chl|cloudflare|captcha|access denied/i.test(text.slice(0, 8_000)),
        title: text.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim().slice(0, 120) || null,
        listingHints: (text.match(/\/(?:en\/)?(?:pr|usd)\/[A-Za-z0-9_\-/?=&%]+/gi) || []).length,
        listingLinks: linksFromHtml(text, response.url || url),
        imageHosts: imageHosts(text, response.url || url),
      });
    } catch (error) {
      results.push({ name, error: String((error as Error)?.message || error).slice(0, 180), ms: Date.now() - started });
    }
  }
  return NextResponse.json({ runtime: "yandex-serverless", elapsedMs: Date.now() - startedAt, results }, { headers: { "cache-control": "no-store" } });
}
