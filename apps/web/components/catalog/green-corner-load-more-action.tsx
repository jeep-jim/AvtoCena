import { CatalogCard } from "./CatalogCard";
import type { GreenFilters } from "@/lib/catalog/green-corner-search";
// Fixed-stock pagination is a public read. GET also works through the production gateway.
export async function loadMoreGreenCorner(query: GreenFilters, page: number) {
 const params=new URLSearchParams(Object.entries(query).filter((entry):entry is [string,string]=>typeof entry[1]==="string"));
 params.set("page",String(page));
 const response=await fetch(`/api/catalog/green?${params}`,{cache:"no-store",signal:AbortSignal.timeout(30000)});
 if(!response.ok)throw Error(`green_page_http_${response.status}`);
 const result=await response.json();
 if(result.page!==page||!Array.isArray(result.items)||!Number.isSafeInteger(result.total))throw Error("invalid_green_page");
 return {cards:result.items.map((offer:any)=><CatalogCard key={offer.id} offer={offer} compact dense />),ids:result.items.map((offer:any)=>offer.id),total:result.total,page};
}
