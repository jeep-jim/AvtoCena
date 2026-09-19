"use server";

import { CatalogCard } from "./CatalogCard";
import { readCatalogMarketPage } from "@/lib/catalog/market-page";
import type { CatalogSearchParams } from "@/lib/catalog/types";
import { PUBLIC_CATALOG_MARKET_SET } from "@/lib/catalog/runtime-config";
import type { CatalogMarket } from "@/lib/catalog/types";

export async function loadMoreCatalog(query: CatalogSearchParams, page: number) {
  if (!PUBLIC_CATALOG_MARKET_SET.has(query.market as CatalogMarket) || !Number.isInteger(page) || page < 1 || page > 10000) throw new Error("invalid_catalog_page");
  const result = await readCatalogMarketPage({...query, page});
  return {cards: result.items.map((offer: any) => <CatalogCard key={offer.id} offer={offer} compact dense />), ids: result.items.map((offer: any) => offer.id), total: result.total, page, generationId: result.generationId};
}
