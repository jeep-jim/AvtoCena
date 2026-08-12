import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const headers = {
  accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9,ka;q=0.8",
  "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/150 Safari/537.36",
};

function absolute(value: string, base: string) {
  try { return new URL(value.replace(/&amp;/g, "&").replace(/\\\//g, "/"), base).toString(); } catch { return ""; }
}

function imageUrls(markup: string, base: string) {
  const values: string[] = [];
  for (const match of markup.matchAll(/(?:src|data-src|data-original|data-lazy-src|href|content)=["']([^"']+)["']/gi)) values.push(match[1]);
  for (const match of markup.matchAll(/(?:srcset|data-srcset)=["']([^"']+)["']/gi)) match[1].split(",").forEach((entry) => values.push(entry.trim().split(/\s+/)[0]));
  for (const match of markup.matchAll(/https?:\\?\/\\?\/[^"'\\\s<>]+?\.(?:jpe?g|png|webp|avif)(?:\?[^"'\\\s<>]*)?/gi)) values.push(match[0].replace(/\\\//g, "/"));
  return [...new Set(values.map((value) => absolute(value, base)).filter((url) => {
    if (!/^https?:/i.test(url) || /logo|icon|avatar|banner|sprite|placeholder|no[-_ ]?photo|qrcode/i.test(url)) return false;
    try { const parsed = new URL(url); return /(?:^|\.)tnet\.ge$/i.test(parsed.host) && /\.(?:jpe?g|png|webp|avif)$/i.test(parsed.pathname); } catch { return false; }
  }))];
}

function currentListings(markup: string, base: string) {
  const grouped = new Map<string, { id: string; url: string; index: number }>();
  for (const match of markup.matchAll(/href=["']([^"']+)["']/gi)) {
    const url = absolute(match[1], base);
    let pathname = "";
    try { pathname = new URL(url).pathname; } catch { continue; }
    const id = pathname.match(/\/en\/pr\/(\d+)\//i)?.[1];
    if (!id || /\/for-rent(?:-|\/)/i.test(pathname)) continue;
    const index = match.index || 0;
    const previous = grouped.get(id);
    if (!previous || index < previous.index) grouped.set(id, { id, url, index });
  }
  const rows = [...grouped.values()].sort((left, right) => left.index - right.index);
  return rows.slice(0, 2).map((entry, index) => {
    const next = rows[index + 1]?.index ?? Math.min(markup.length, entry.index + 18_000);
    const card = markup.slice(Math.max(0, entry.index - 2_000), Math.max(entry.index + 1, next));
    return { ...entry, cardBytes: Buffer.byteLength(card), cardImages: imageUrls(card, base).slice(0, 40) };
  });
}

function valueSummary(value: unknown) {
  if (Array.isArray(value)) return { type: "array", length: value.length, sample: value.slice(0, 12) };
  if (value && typeof value === "object") return { type: "object", keys: Object.keys(value as Record<string, unknown>).slice(0, 80) };
  return { type: typeof value, value };
}

export async function GET() {
  const mainResponse = await fetch("https://www.myauto.ge/en/main", { headers, redirect: "follow", cache: "no-store", signal: AbortSignal.timeout(15_000) });
  const mainMarkup = await mainResponse.text();
  const base = mainResponse.url || "https://www.myauto.ge/en/main";
  const listings = currentListings(mainMarkup, base);
  const results = [];

  for (const listing of listings) {
    const apiUrl = `https://api2.myauto.ge/en/products/${listing.id}`;
    const apiResponse = await fetch(apiUrl, { headers, redirect: "follow", cache: "no-store", signal: AbortSignal.timeout(12_000) });
    const apiText = await apiResponse.text();
    let data: any = null;
    try { data = JSON.parse(apiText); } catch { /* report parse state */ }
    const info = data?.data?.info || {};

    let detail: Record<string, unknown> = { status: null, bytes: 0, images: [] };
    try {
      const response = await fetch(listing.url, { headers, redirect: "follow", cache: "no-store", signal: AbortSignal.timeout(15_000) });
      const markup = await response.text();
      detail = {
        status: response.status,
        bytes: Buffer.byteLength(markup),
        finalUrl: response.url || listing.url,
        images: imageUrls(markup, response.url || listing.url).slice(0, 120),
      };
    } catch (error) {
      detail = { error: String((error as Error)?.message || error) };
    }

    results.push({
      id: listing.id,
      detailUrl: listing.url,
      mainStatus: mainResponse.status,
      mainBytes: Buffer.byteLength(mainMarkup),
      cardBytes: listing.cardBytes,
      cardImages: listing.cardImages,
      apiStatus: apiResponse.status,
      apiBytes: Buffer.byteLength(apiText),
      photo: valueSummary(info.photo),
      photoVer: valueSummary(info.photo_ver),
      picNumber: valueSummary(info.pic_number),
      thumbnailUrl: valueSummary(info.thumbnail_url),
      detail,
    });
  }

  return NextResponse.json({
    runtime: "yandex-serverless",
    mode: "dynamic-current-myauto-gallery-diagnostic",
    mainStatus: mainResponse.status,
    mainBytes: Buffer.byteLength(mainMarkup),
    listingCount: listings.length,
    results,
  }, { headers: { "cache-control": "no-store" } });
}
