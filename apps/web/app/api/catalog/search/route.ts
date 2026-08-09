import { NextResponse } from "next/server";
import { searchOffers } from "@/lib/catalog/storage";
import type { CatalogSearchParams } from "@/lib/catalog/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function text(url: URL, key: string) {
  return String(url.searchParams.get(key) || "").trim() || undefined;
}

function number(url: URL, key: string) {
  const raw = url.searchParams.get(key);
  if (raw == null || raw === "") return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const params: CatalogSearchParams = {
    market: text(url, "market"),
    make: text(url, "make"),
    model: text(url, "model"),
    hasPrice: text(url, "hasPrice"),
    budgetFrom: number(url, "budgetFrom"),
    budgetTo: number(url, "budgetTo"),
    yearFrom: number(url, "yearFrom"),
    yearTo: number(url, "yearTo"),
    mileageFrom: number(url, "mileageFrom"),
    mileageTo: number(url, "mileageTo"),
    engineFrom: number(url, "engineFrom"),
    engineTo: number(url, "engineTo"),
    powerFrom: number(url, "powerFrom"),
    powerTo: number(url, "powerTo"),
    fuel: text(url, "fuel"),
    transmission: text(url, "transmission"),
    drive: text(url, "drive"),
    bodyType: text(url, "bodyType"),
    auctionGrade: text(url, "auctionGrade"),
    sort: text(url, "sort"),
    page: number(url, "page"),
    pageSize: number(url, "pageSize"),
  };

  try {
    const result = await searchOffers(params);
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    console.error("catalog_search_api_failed", error);
    return NextResponse.json({ error: "catalog_search_failed", items: [], total: 0 }, { status: 500 });
  }
}
