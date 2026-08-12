import { NextResponse } from "next/server";
import { myAutoListSource } from "@/lib/catalog/myauto-list-source";
import { autoPapaGeorgiaSource, autoPapaDetailOriginalPhotoUrls } from "@/lib/catalog/autopapa-georgia-source";
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

function rawImages(offer: VehicleOffer) {
  const raw = (offer.operational?.raw || {}) as { images?: unknown[]; parsed?: { images?: unknown[] } };
  return [...new Set([...(raw.images || []), ...(raw.parsed?.images || [])].map(String).filter((url) => /^https?:\/\//i.test(url)))].slice(0, 30);
}

function scriptUrls(markup: string, base: string) {
  const urls = [...markup.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)]
    .map((match) => absolute(match[1], base))
    .filter(Boolean)
    .filter((url) => {
      try {
        const parsed = new URL(url);
        return /(?:^|\.)(?:myauto\.ge|tnet\.ge)$/i.test(parsed.host) && /\.js(?:$|\?)/i.test(parsed.pathname + parsed.search);
      } catch { return false; }
    });
  return [...new Set(urls)];
}

function proofSnippets(text: string) {
  const terms = ["myauto/photos", "photo_ver", "pic_number", "thumbs/", "original", "large", "medium", "static.tnet.ge"];
  const compact = text.replace(/\s+/g, " ");
  const lower = compact.toLowerCase();
  const snippets: Array<{ term: string; snippet: string }> = [];
  for (const term of terms) {
    const index = lower.indexOf(term.toLowerCase());
    if (index < 0) continue;
    snippets.push({ term, snippet: compact.slice(Math.max(0, index - 220), Math.min(compact.length, index + term.length + 320)) });
  }
  return snippets;
}

async function fetchText(url: string, timeoutMs = 12_000) {
  const response = await fetch(url, { headers, redirect: "follow", cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
  const text = await response.text();
  return { response, text };
}

async function inspectMyAuto() {
  const page = await myAutoListSource.fetchPage("1");
  const offer = (page.items || [])
    .map((item) => myAutoListSource.normalizeOffer(item as never))
    .find((candidate): candidate is VehicleOffer => Boolean(candidate && candidate.year >= 2020));
  if (!offer) return { ok: false, error: "no_current_2020_plus_offer" };

  const id = String(offer.sourceOfferId || "");
  const detailUrl = String(offer.operational?.sourceUrl || "");
  const apiResult = await fetchText(`https://api2.myauto.ge/en/products/${id}`);
  let api: any = null;
  try { api = JSON.parse(apiResult.text); } catch { /* metadata below is enough */ }
  const info = api?.data?.info || {};

  const detail = await fetchText(detailUrl, 15_000);
  const scripts = scriptUrls(detail.text, detail.response.url || detailUrl).slice(0, 16);
  const inspected = await Promise.all(scripts.map(async (url) => {
    try {
      const result = await fetchText(url, 8_000);
      return {
        url,
        status: result.response.status,
        bytes: Buffer.byteLength(result.text),
        proofs: proofSnippets(result.text),
      };
    } catch (error) {
      return { url, error: String((error as Error)?.message || error) };
    }
  }));

  return {
    ok: true,
    id,
    make: offer.make,
    model: offer.model,
    year: offer.year,
    detailUrl,
    listImages: rawImages(offer),
    apiStatus: apiResult.response.status,
    photo: info.photo ?? null,
    photoVer: info.photo_ver ?? null,
    picNumber: info.pic_number ?? null,
    detailStatus: detail.response.status,
    detailBytes: Buffer.byteLength(detail.text),
    scriptCount: scripts.length,
    scripts: inspected,
  };
}

async function inspectAutoPapa() {
  const page = await autoPapaGeorgiaSource.fetchPage("1");
  const offers = (page.items || [])
    .map((item) => autoPapaGeorgiaSource.normalizeOffer(item as never))
    .filter((offer): offer is VehicleOffer => Boolean(offer && offer.year >= 2020))
    .slice(0, 3);
  const samples = [];
  for (const offer of offers) {
    const detailUrl = String(offer.operational?.sourceUrl || "");
    const detail = await fetchText(detailUrl, 15_000);
    const originals = autoPapaDetailOriginalPhotoUrls(detail.text, detail.response.url || detailUrl).slice(0, 30);
    samples.push({
      id: offer.sourceOfferId,
      make: offer.make,
      model: offer.model,
      year: offer.year,
      sourcePrice: offer.sourcePrice,
      listImages: rawImages(offer),
      detailStatus: detail.response.status,
      originalCount: originals.length,
      originals,
    });
  }
  return { ok: true, fetched: page.items?.length || 0, normalized2020Plus: offers.length, samples };
}

export async function GET() {
  const [myauto, autopapa] = await Promise.all([
    inspectMyAuto().catch((error) => ({ ok: false, error: String((error as Error)?.message || error) })),
    inspectAutoPapa().catch((error) => ({ ok: false, error: String((error as Error)?.message || error) })),
  ]);
  return NextResponse.json({
    runtime: "yandex-serverless",
    mode: "georgia-gallery-formula-proof-read-only",
    myauto,
    autopapa,
  }, { headers: { "cache-control": "no-store" } });
}
