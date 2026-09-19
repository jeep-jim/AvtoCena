import { applyActiveBusinessPricingBatch } from "@/lib/catalog/live-business-pricing";
import { NextResponse } from "next/server";
import { loadPublicRateExtras } from "@/lib/catalog/public-rates";
import { readCatalogFacets, searchOffers } from "@/lib/catalog/storage";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function n(v: string | null) {
  const x = Number(v);
  return Number.isFinite(x) && x > 0 ? x : undefined;
}

export async function GET(request: Request) {
  const started = performance.now();
  const u = new URL(request.url);
  const p = u.searchParams;
  const query: Parameters<typeof searchOffers>[0] = {
    market: p.get("market") || undefined,
    make: p.get("make") || p.get("brand") || undefined,
    model: p.get("model") || undefined,
    hasPrice: p.get("hasPrice") || undefined,
    budgetFrom: n(p.get("budgetFrom")),
    budgetTo: n(p.get("budgetTo") || p.get("budget")),
    yearFrom: n(p.get("yearFrom")),
    yearTo: n(p.get("yearTo")),
    mileageFrom: n(p.get("mileageFrom")),
    mileageTo: n(p.get("mileageTo")),
    engineFrom: n(p.get("engineFrom")),
    engineTo: n(p.get("engineTo")),
    powerFrom: n(p.get("powerFrom")),
    powerTo: n(p.get("powerTo")),
    fuel: p.get("fuel") || undefined,
    transmission: p.get("transmission") || undefined,
    drive: p.get("drive") || undefined,
    bodyType: p.get("bodyType") || p.get("body") || undefined,
    auctionGrade: p.get("auctionGrade") || undefined,
    sort: p.get("sort") || undefined,
    page: n(p.get("page")),
    pageSize: n(p.get("pageSize")),
  };
  const [result, facets, rateExtras] = await Promise.all([
    searchOffers(query),
    p.get("includeFacets") === "1" ? readCatalogFacets(query) : Promise.resolve(undefined),
    p.get("includeRates") === "1" ? loadPublicRateExtras() : Promise.resolve(undefined),
  ]);
  const extras: Record<string, unknown> = {};
  if (facets) extras.facets = facets;
  if (rateExtras) Object.assign(extras, rateExtras);
  const readMs = performance.now() - started;
  const items = p.get("countOnly") === "1" ? [] : await applyActiveBusinessPricingBatch(result.items);
  const pricingMs = performance.now() - started - readMs;
  return NextResponse.json({ ok: true, ...result, items, ...extras }, { headers: { "Cache-Control": "public, max-age=30, s-maxage=30", "Server-Timing": `catalog-read;dur=${readMs.toFixed(1)}, catalog-pricing;dur=${pricingMs.toFixed(1)}` } });
}
