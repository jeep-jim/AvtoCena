import { NextResponse } from "next/server";
import { myAutoListSource } from "@/lib/catalog/myauto-list-source";
import type { VehicleOffer } from "@/lib/catalog/types";

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

function detailImages(markup: string, base: string) {
  const values: string[] = [];
  for (const match of markup.matchAll(/(?:src|data-src|data-original|data-lazy-src|href|content)=["']([^"']+)["']/gi)) values.push(match[1]);
  for (const match of markup.matchAll(/(?:srcset|data-srcset)=["']([^"']+)["']/gi)) match[1].split(",").forEach((entry) => values.push(entry.trim().split(/\s+/)[0]));
  for (const match of markup.matchAll(/https?:\\?\/\\?\/[^"'\\\s<>]+?\.(?:jpe?g|png|webp|avif)(?:\?[^"'\\\s<>]*)?/gi)) values.push(match[0].replace(/\\\//g, "/"));
  return [...new Set(values.map((value) => absolute(value, base)).filter((url) => {
    if (!/^https?:/i.test(url) || /logo|icon|avatar|banner|sprite|placeholder|no[-_ ]?photo|qrcode|appstore|googleplay/i.test(url)) return false;
    try { const parsed = new URL(url); return /(?:^|\.)tnet\.ge$/i.test(parsed.host) && /\.(?:jpe?g|png|webp|avif)(?:$|\?)/i.test(parsed.pathname + parsed.search); } catch { return false; }
  }))].slice(0, 120);
}

function rawImages(offer: VehicleOffer) {
  const raw = (offer.operational?.raw || {}) as { images?: unknown[]; parsed?: { images?: unknown[] } };
  return [...new Set([...(raw.images || []), ...(raw.parsed?.images || [])].map(String).filter((url) => /^https?:\/\//i.test(url)))].slice(0, 30);
}

export async function GET() {
  const page = await myAutoListSource.fetchPage("1");
  const offers = (page.items || [])
    .map((item) => myAutoListSource.normalizeOffer(item as never))
    .filter((offer): offer is VehicleOffer => Boolean(offer && offer.year >= 2020))
    .slice(0, 3);
  const results = [];

  for (const offer of offers) {
    const id = String(offer.sourceOfferId || "");
    const detailUrl = String(offer.operational?.sourceUrl || "");
    const listImages = rawImages(offer);
    const apiUrl = `https://api2.myauto.ge/en/products/${id}`;
    const apiResponse = await fetch(apiUrl, { headers, redirect: "follow", cache: "no-store", signal: AbortSignal.timeout(12_000) });
    const apiText = await apiResponse.text();
    let data: any = null;
    try { data = JSON.parse(apiText); } catch { /* metadata below shows parse state */ }
    const info = data?.data?.info || {};

    let detail: Record<string, unknown> = { status: null, bytes: 0, images: [] };
    if (detailUrl) {
      try {
        const response = await fetch(detailUrl, { headers, redirect: "follow", cache: "no-store", signal: AbortSignal.timeout(15_000) });
        const markup = await response.text();
        detail = {
          status: response.status,
          bytes: Buffer.byteLength(markup),
          finalUrl: response.url || detailUrl,
          images: detailImages(markup, response.url || detailUrl),
        };
      } catch (error) {
        detail = { error: String((error as Error)?.message || error) };
      }
    }

    results.push({
      id,
      make: offer.make,
      model: offer.model,
      year: offer.year,
      detailUrl,
      listImages,
      apiStatus: apiResponse.status,
      apiBytes: Buffer.byteLength(apiText),
      photo: info.photo ?? null,
      photoVer: info.photo_ver ?? null,
      picNumber: info.pic_number ?? null,
      thumbnailUrl: info.thumbnail_url ?? null,
      detail,
    });
  }

  return NextResponse.json({ runtime: "yandex-serverless", mode: "current-myauto-list-bound-gallery-diagnostic", count: results.length, results }, { headers: { "cache-control": "no-store" } });
}
