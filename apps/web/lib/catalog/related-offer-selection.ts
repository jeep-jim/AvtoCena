import { isSellerPricedOffer } from "./seller-price-contract";
import { isRenderablePublicCatalogOffer } from "./offer-quality";
import { isGreenCornerOffer } from "./green-corner-contract";
import { priceCandidatesUntil } from "./price-candidates";
function similarModelKey(offer: any) {
  const make = String(offer?.make || "").trim().toLocaleLowerCase("ru-RU").replace(/\s+/g, " ");
  const model = String(offer?.model || "").trim().toLocaleLowerCase("ru-RU").replace(/\s+/g, " ");
  return make && model ? `${make}|${model}` : `id:${String(offer?.id || "")}`;
}

function diverseSimilarOffers(rows: any[], current: any, limit = 4, excludedIds = new Set<string>()) {
  const currentKey = similarModelKey(current);
  const seen = new Set<string>(currentKey ? [currentKey] : []);
  const differentModels: any[] = [];
  const repeats: any[] = [];
  for (const row of rows) {
    if (excludedIds.has(String(row?.id || ""))) continue;
    const key = similarModelKey(row);
    if (key && !seen.has(key)) {
      seen.add(key);
      differentModels.push(row);
    } else {
      repeats.push(row);
    }
  }
  return [...differentModels, ...repeats].slice(0, limit);
}

export async function selectRelatedOfferGroups({current,modelRows,marketRows,crossResults,greenModels,greenRows,price,renderable}:{
 current:any;modelRows:any[];marketRows:any[];crossResults:Array<{market:string;items:any[]}>;greenModels:any[];greenRows:any[];
 price:(rows:any[])=>Promise<any[]>;renderable:(row:any)=>boolean;
}) {
  const greenCurrent = isGreenCornerOffer(current);
  const selectedIds = new Set<string>([String(current.id)]);
  const priceRows = async (candidates:any[],limit=4) => {
    const seen = new Set(selectedIds);
    const unique = candidates.filter(row=>{const id=String(row.id);if(seen.has(id))return false;seen.add(id);return true;});
    const rows = await priceCandidatesUntil(unique,price,renderable,rows=>rows.length>=limit).catch(error=>{console.error("offer_related_pricing_failed",error);return [];});
    const result=rows.slice(0,limit);result.forEach(row=>selectedIds.add(String(row.id)));return result;
  };
  const stockModels = greenCurrent ? await priceRows(greenModels) : [];
  const sameModel = await priceRows([...modelRows,...(!greenCurrent && current.market==='japan' ? greenModels : [])]);
  const crossMarketGroups: Array<{market:string;items:any[]}> = [];
  for(const result of crossResults) {
    const items=await priceRows([...result.items,...(result.market==='japan'?greenModels:[])]);
    if(items.length)crossMarketGroups.push({market:result.market,items});
  }
  const marketCandidates = [...marketRows,...(current.market==='japan' ? greenRows : [])];
  const selectedMarketRows = await priceRows(diverseSimilarOffers(marketCandidates,current,24,selectedIds));
  return {stockModels,sameModel,crossMarketGroups,marketRows:selectedMarketRows};
}

/** Stock rows come from the independently validated Green Corner snapshot, not auction projections. */
export function isRenderableRelatedOffer(offer:any) {
  if(isGreenCornerOffer(offer)) return isSellerPricedOffer(offer)
    && Boolean(String(offer.make||'').trim() && String(offer.model||'').trim())
    && Array.isArray(offer.images) && offer.images.length>0;
  return isRenderablePublicCatalogOffer(offer);
}
