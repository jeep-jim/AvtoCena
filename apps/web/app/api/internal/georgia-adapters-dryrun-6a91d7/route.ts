import { NextResponse } from "next/server";
import { myAutoListSource } from "@/lib/catalog/myauto-list-source";
import { scaleMarketSources } from "@/lib/catalog/scale-market-sources";
import { isCatalogMarketSourceAllowed, isCatalogYearAllowed } from "@/lib/catalog/offer-quality";
import type { CatalogSourceAdapter, VehicleOffer } from "@/lib/catalog/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function rawImageUrls(offer: VehicleOffer) {
  const raw = (offer.operational?.raw || {}) as { images?: unknown[]; parsed?: { images?: unknown[] } };
  return [...new Set([...(raw.images || []), ...(raw.parsed?.images || [])].map(String).filter((url) => /^https?:\/\//i.test(url)))].slice(0, 30);
}

async function dryRun(source: CatalogSourceAdapter) {
  const started = Date.now();
  try {
    const page = await source.fetchPage("1");
    const normalized = (page.items || [])
      .map((item) => source.normalizeOffer(item as never))
      .filter((offer): offer is VehicleOffer => Boolean(offer));
    const canonical = normalized.filter((offer) => isCatalogMarketSourceAllowed(offer));
    const currentYear = canonical.filter((offer) => isCatalogYearAllowed(offer.year, offer.market));
    return {
      sourceId: source.sourceId,
      ok: true,
      ms: Date.now() - started,
      fetched: page.items?.length || 0,
      normalized: normalized.length,
      canonical: canonical.length,
      year2020Plus: currentYear.length,
      nextCursor: page.nextCursor || null,
      health: page.health || null,
      samples: currentYear.slice(0, 8).map((offer) => ({
        sourceOfferId: offer.sourceOfferId,
        make: offer.make,
        model: offer.model,
        year: offer.year,
        sourcePrice: offer.sourcePrice,
        sourceCurrency: offer.sourceCurrency,
        sourceHost: (() => { try { return new URL(String(offer.operational?.sourceUrl || "")).host; } catch { return ""; } })(),
        rawImages: rawImageUrls(offer).length,
        rawImageHosts: [...new Set(rawImageUrls(offer).map((url) => { try { return new URL(url).host; } catch { return ""; } }).filter(Boolean))],
      })),
    };
  } catch (error) {
    return { sourceId: source.sourceId, ok: false, ms: Date.now() - started, error: String((error as Error)?.message || error).slice(0, 1_200) };
  }
}

export async function GET() {
  const autoPapa = scaleMarketSources.find((source) => source.sourceId === "autopapa_georgia_open");
  const sources = [myAutoListSource, autoPapa].filter((source): source is CatalogSourceAdapter => Boolean(source));
  const results = [];
  for (const source of sources) results.push(await dryRun(source));
  return NextResponse.json({ runtime: "yandex-serverless", mode: "dry-run-no-persist-no-image-cache", results }, { headers: { "cache-control": "no-store" } });
}
