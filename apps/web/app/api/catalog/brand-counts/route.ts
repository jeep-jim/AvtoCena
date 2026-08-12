import { NextResponse } from "next/server";
import { readCatalogFacets, searchOffers } from "@/lib/catalog/storage";
import type { CatalogSearchParams } from "@/lib/catalog/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function text(url: URL, key: string) {
  return String(url.searchParams.get(key) || "").trim() || undefined;
}

function positiveNumber(url: URL, key: string) {
  const value = Number(url.searchParams.get(key) || 0);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  if (!items.length) return [];
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index]);
    }
  }));
  return results;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const params: CatalogSearchParams = {
    market: text(url, "market"),
    hasPrice: text(url, "hasPrice"),
    budgetFrom: positiveNumber(url, "budgetFrom"),
    budgetTo: positiveNumber(url, "budgetTo") || positiveNumber(url, "budget"),
    yearFrom: positiveNumber(url, "yearFrom"),
    yearTo: positiveNumber(url, "yearTo"),
    mileageFrom: positiveNumber(url, "mileageFrom"),
    mileageTo: positiveNumber(url, "mileageTo"),
    engineFrom: positiveNumber(url, "engineFrom"),
    engineTo: positiveNumber(url, "engineTo"),
    powerFrom: positiveNumber(url, "powerFrom"),
    powerTo: positiveNumber(url, "powerTo"),
    fuel: text(url, "fuel"),
    transmission: text(url, "transmission"),
    drive: text(url, "drive"),
    bodyType: text(url, "bodyType"),
    auctionGrade: text(url, "auctionGrade"),
    auctionDateFrom: text(url, "auctionDateFrom"),
    auctionDateTo: text(url, "auctionDateTo"),
  };

  const facets = await readCatalogFacets(params);
  const pairs = await mapWithConcurrency(facets.makes || [], 8, async (make) => {
    const result = await searchOffers({ ...params, make, page: 1, pageSize: 1, sort: "updatedAt" });
    return [make, Number(result.total || 0)] as const;
  });

  return NextResponse.json(
    { generationId: facets.generationId, counts: Object.fromEntries(pairs) },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
