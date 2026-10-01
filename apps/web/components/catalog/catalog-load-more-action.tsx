import { CatalogCard } from "./CatalogCard";
import type { CatalogSearchParams } from "@/lib/catalog/types";

// Pagination is a public read, not a mutation. GET avoids the Server Action
// queue and the page/layout render that accompanies an action response.
export async function loadMoreCatalog(query: CatalogSearchParams, page: number) {
  const params = new URLSearchParams(Object.entries(query).filter(([,v])=>v!==undefined&&v!=="").map(([k,v])=>[k,String(v)]));
  params.set("marketPage","1");
  params.set("page",String(page));
  const response = await fetch(`/api/catalog/search?${params}`, {signal:AbortSignal.timeout(30000)});
  if (!response.ok) throw new Error(`catalog_page_http_${response.status}`);
  const result = await response.json();
  if (result.page !== page || !Array.isArray(result.items) || !Number.isSafeInteger(result.total)) throw new Error("invalid_catalog_page");
  return {cards: result.items.map((offer: any) => <CatalogCard key={offer.id} offer={offer} compact dense />), ids: result.items.map((offer: any) => offer.id), total: result.total, page, generationId: result.generationId};
}
