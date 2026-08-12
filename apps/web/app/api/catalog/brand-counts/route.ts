import { NextResponse } from "next/server";
import { readCatalogBrandCounts } from "@/lib/catalog/storage";
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
  const summary = await readCatalogBrandCounts(params);
  return NextResponse.json(summary, { headers: { "Cache-Control": "private, max-age=15, stale-while-revalidate=30" } });
}
