"use server";
import { CatalogCard } from "./CatalogCard";
import { currentGreenCornerPrices, readGreenCorner, publicGreenOffer } from "@/lib/catalog/green-corner";
import { applyActiveBusinessPricingBatch } from "@/lib/catalog/live-business-pricing";
import { filterGreenCorner, type GreenFilters } from "@/lib/catalog/green-corner-search";
export async function loadMoreGreenCorner(query: GreenFilters, page: number) {
 if (!query || typeof query !== "object" || Object.values(query).some(value=>value!=null&&(typeof value!=="string"||value.length>200)) || !Number.isInteger(page) || page < 1 || page > 10000) throw Error("invalid_green_page");
 const snapshot=await readGreenCorner();
 const current=await currentGreenCornerPrices(snapshot.items);
 const matched=filterGreenCorner(current,query);
 const items=await applyActiveBusinessPricingBatch(matched.slice((page-1)*24,page*24).map(publicGreenOffer));
 return {cards:items.map(offer=><CatalogCard key={offer.id} offer={offer} compact dense />),ids:items.map(offer=>offer.id),total:matched.length,page};
}
