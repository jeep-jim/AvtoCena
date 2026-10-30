import {CatalogPageRequestError,CATALOG_PAGE_REQUEST_TIMEOUT_MS} from "./page-request-error";
import { CatalogCard } from "./CatalogCard";
import type { CatalogSearchParams } from "@/lib/catalog/types";

// Pagination is a public read, not a mutation. GET avoids the Server Action
// queue and the page/layout render that accompanies an action response.
export async function loadMoreCatalog(query: CatalogSearchParams, page: number, after?:string|null) {
  const params = new URLSearchParams(Object.entries(query).filter(([,v])=>v!==undefined&&v!=="").map(([k,v])=>[k,String(v)]));
  if(after)params.set("after",after);else params.delete("after");
  params.set("marketPage","1");
  params.set("page",String(page));
  const signal=AbortSignal.timeout(CATALOG_PAGE_REQUEST_TIMEOUT_MS);
  let result;
  try {
    const response = await fetch(`/api/catalog/search?${params}`, {signal});
    if (!response.ok) throw new CatalogPageRequestError('unavailable');
    result = await response.json();
  } catch(error) {
    if(signal.aborted)throw new CatalogPageRequestError('timeout');
    throw error;
  }
  if (result.page !== page || !Array.isArray(result.items) || !(Number.isSafeInteger(result.total)||result.total===null)) throw new CatalogPageRequestError("invalid");
  return {incomplete:Boolean(result.partial||result.stale),cards: result.items.map((offer: any) => <CatalogCard key={offer.id} offer={offer} compact dense />), ids: result.items.map((offer: any) => offer.id), total: result.total, page, generationId: result.generationId, nextCursor: typeof result.nextCursor === "string" ? result.nextCursor : result.nextCursor === null ? null : undefined, hasMore: typeof result.hasMore === "boolean" ? result.hasMore : undefined};
}
