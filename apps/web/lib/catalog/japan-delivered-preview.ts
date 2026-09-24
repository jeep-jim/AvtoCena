import {isGreenCornerOffer} from "./green-corner-contract";
import { assessJapanExportRestriction } from "./japan-export-restriction";
import { unstable_cache } from "next/cache";
import { japanPreviewParameters } from "./japan-preview-parameters";
import { calculateOfferWithCustomerParametersDetailed } from "./customs-pricing";
import { readDataJson } from "../data";
import { catalogGenerationId } from "./storage";
import { DetailReadCache } from "./detail-read-cache";
import { japanPreviewInputPath, matchesJapanPreviewInput, type JapanPreviewInputIndex } from "./japan-preview-inputs";
import type { VehicleOffer } from "./types";

const inputs = new DetailReadCache<JapanPreviewInputIndex | null>({maxEntries:2,maxBytes:16*1024*1024,ttlMs:60_000,concurrency:1});
export async function readJapanPreviewInputs() {
  const generationId = await catalogGenerationId();
  return inputs.get(generationId, () => readDataJson<JapanPreviewInputIndex | null>(japanPreviewInputPath(generationId),null));
}
const preview = unstable_cache(async (id: string, _revision: string, generationId: string, updatedAt: string, sourcePrice: number | null, sourceCurrency: string | null) => {
  const index = await readJapanPreviewInputs().catch(()=>null);
  const entry = index?.version===1 && index.generationId===generationId ? index.entries?.[id] : undefined;
  if(entry && matchesJapanPreviewInput(entry,{updatedAt,sourcePrice,sourceCurrency})) {
    if(!entry.parameters)return null;
    const result = await calculateOfferWithCustomerParametersDetailed(entry.offer as VehicleOffer,entry.parameters);
    return result.ok && Number(result.calculation.totalRub)>0
      ? {totalRub:result.calculation.totalRub,currencyRate:result.calculation.currencyRate,deliveryPricingBasis:result.calculation.deliveryPricingBasis,engineCc:entry.parameters.engineCc,estimated:true,japanExportRestriction:entry.restriction} : null;
  }
  // Missing/old derived index retains the authoritative full-record path.
  const {getOfferForPage}=await import("./offer-page-data");
  const offer = await getOfferForPage(id);
  if (!offer || offer.market !== "japan" || offer.catalogPricingMode !== "seller") return null;
  let parameters;
  try { parameters = japanPreviewParameters(offer); } catch { return null; }
  const result = await calculateOfferWithCustomerParametersDetailed(offer, parameters);
  return result.ok && Number(result.calculation.totalRub) > 0
    ? { totalRub: result.calculation.totalRub, currencyRate:result.calculation.currencyRate, deliveryPricingBasis:result.calculation.deliveryPricingBasis, engineCc: parameters.engineCc, estimated: true, japanExportRestriction: assessJapanExportRestriction(offer) } : null;
}, ["japan-delivered-preview-v8-bound-rate"], { revalidate: 900 });

export async function attachJapanDeliveredPreviews<T extends Partial<VehicleOffer>>(offers: T[], configuration: unknown): Promise<T[]> {
  const result = [...offers];
  const generationId = offers.some(o=>o.market==="japan" && o.catalogPricingMode==="seller") ? await catalogGenerationId() : "";
  let cursor = 0;
  // Only visible cards, bounded storage/calculation concurrency, no browser fan-out.
  await Promise.all(Array.from({ length: Math.min(4, offers.length) }, async () => {
    while (cursor < offers.length) {
      const index = cursor++;
      const offer = offers[index];
      if ((offer as any).savedCalculationPreview || offer.market !== "japan" || offer.catalogPricingMode !== "seller" || !offer.id) continue;
      try {
        if(isGreenCornerOffer(offer)) {
          // Stock refresh is independent of auction generations and detail caches.
          // Calculate the currently published CIF, never an older cached FOB row.
          const parameters=japanPreviewParameters(offer as VehicleOffer);
          const fresh=await calculateOfferWithCustomerParametersDetailed(offer as VehicleOffer,parameters);
          if(fresh.ok && Number(fresh.calculation.totalRub)>0) result[index]={...offer,japanDeliveredPreview:{
            totalRub:fresh.calculation.totalRub,currencyRate:fresh.calculation.currencyRate,
            deliveryPricingBasis:fresh.calculation.deliveryPricingBasis,engineCc:parameters.engineCc,estimated:true,
            japanExportRestriction:assessJapanExportRestriction(offer)}};
          continue;
        }
        const quote = await preview(offer.id, JSON.stringify([offer.updatedAt, offer.sourcePrice, configuration, new Date().toISOString().slice(0, 10)]), generationId, offer.updatedAt || "", offer.sourcePrice ?? null, offer.sourceCurrency ?? null);
        if (quote) result[index] = { ...offer, japanExportRestriction: quote.japanExportRestriction, japanDeliveredPreview: quote };
      } catch { /* A failed estimate preserves the explicitly labelled source price. */ }
    }
  }));
  return result;
}

// One bounded derived lookup per generation/configuration, shared by filters and cards.
// Never fetch thousands of detail shards on a public search request.
const searchQuotes = new DetailReadCache<Record<string, any>>({maxEntries:2,maxBytes:12*1024*1024,ttlMs:300_000,concurrency:1});
export async function japanSearchQuotes(generationId: string) {
  const { getEffectiveMarketVersion } = await import("../effective-market-settings");
  const configuration = await getEffectiveMarketVersion("japan");
  const key=JSON.stringify([generationId,configuration,new Date().toISOString().slice(0,10)]);
  return searchQuotes.get(key,async()=>{
    const index=await readJapanPreviewInputs();
    if(index?.version!==1 || index.generationId!==generationId) return {};
    const quotes:Record<string,any>={};
    const entries=Object.entries(index.entries);
    for(let start=0;start<entries.length;start+=64){
      await Promise.all(entries.slice(start,start+64).map(async([id,entry])=>{
        if(!entry.parameters)return;
        const result=await calculateOfferWithCustomerParametersDetailed(entry.offer as VehicleOffer,entry.parameters);
        if(result.ok && Number(result.calculation.totalRub)>0) quotes[id]={
          updatedAt:entry.updatedAt,sourcePrice:entry.sourcePrice,sourceCurrency:entry.sourceCurrency,
          totalRub:result.calculation.totalRub,currencyRate:result.calculation.currencyRate,deliveryPricingBasis:result.calculation.deliveryPricingBasis,
          engineCc:entry.parameters.engineCc,estimated:true,japanExportRestriction:entry.restriction};
      }));
      await new Promise(resolve=>setTimeout(resolve,0));
    }
    return quotes;
  });
}
export async function attachJapanSearchValues<T extends {id:string;market:string;updatedAt?:string;sourcePrice?:number|null;sourceCurrency?:string|null}>(rows:T[], generationId:string):Promise<T[]> {
  if(!rows.some(row=>row.market==="japan"))return rows;
  const quotes=await japanSearchQuotes(generationId);
  return rows.map(row=>{
    const quote=quotes[row.id];
    return row.market==="japan" && quote && matchesJapanPreviewInput(quote,row as any)
      ? {...row,japanDeliveredPreview:quote} : row;
  });
}
