import {applyCatalogEditorial,readCatalogEditorial} from './editorial';
import {withCurrentDepositCosts} from "./deposit-cost-projection";
import {isGreenCornerOffer} from "./green-corner-contract";
import { assessJapanExportRestriction } from "./japan-export-restriction";
import { unstable_cache } from "next/cache";
import { japanPreviewParameters } from "./japan-preview-parameters";
import { calculateOfferWithCustomerParametersDetailed } from "./customs-pricing";
import { getJsonStorage } from "../data";
import { RevalidatedJson } from "./revalidated-json";
import { catalogGenerationId } from "./storage";
import { DetailReadCache } from "./detail-read-cache";
import { japanPreviewInputPath, matchesJapanPreviewInput, type JapanPreviewInputIndex } from "./japan-preview-inputs";
import type { VehicleOffer } from "./types";
import {createHash} from "node:crypto";
import {catalogRateFingerprintInputs} from "./rates";
import {calculationCacheVersion} from "./shared-budget-prices";

const inputs = new DetailReadCache<JapanPreviewInputIndex | null>({maxEntries:2,maxBytes:16*1024*1024,ttlMs:60_000,concurrency:1});
const revalidatedInputs = new RevalidatedJson<JapanPreviewInputIndex|null>(16*1024*1024);
export async function readJapanPreviewInputs() {
  const generationId = await catalogGenerationId();
  return inputs.get(generationId, () => revalidatedInputs.read(getJsonStorage(),japanPreviewInputPath(generationId),null));
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
}, ["japan-delivered-preview-v9-deposit-cost"], { revalidate: 900 });

// Stock refresh is independent of auction generations. Cache only the exact
// current invoice/specifications/rate/settings combination, for at most a minute.
// A changed invoice, bank quote or market configuration gets a different key.
const greenPreview = unstable_cache(async (offer: VehicleOffer, _revision: string) => {
  const parameters = japanPreviewParameters(offer);
  const fresh = await calculateOfferWithCustomerParametersDetailed(offer, parameters);
  return fresh.ok && Number(fresh.calculation.totalRub) > 0 ? {
    totalRub: fresh.calculation.totalRub, currencyRate: fresh.calculation.currencyRate,
    deliveryPricingBasis: fresh.calculation.deliveryPricingBasis, engineCc: parameters.engineCc,
    estimated: true, japanExportRestriction: assessJapanExportRestriction(offer),
  } : null;
}, ["green-cif-preview-v2-deposit-cost"], { revalidate: 60 });

export async function attachJapanDeliveredPreviews<T extends Partial<VehicleOffer>>(offers: T[], configuration: unknown): Promise<T[]> {
  const result = [...offers];
  const generationId = offers.some(o=>o.market==="japan" && o.catalogPricingMode==="seller" && !isGreenCornerOffer(o) && o.sourceId!=="ajes_japan_feed") ? await catalogGenerationId() : "";
  let cursor = 0;
  // Only visible cards, bounded storage/calculation concurrency, no browser fan-out.
  await Promise.all(Array.from({ length: Math.min(4, offers.length) }, async () => {
    while (cursor < offers.length) {
      const index = cursor++;
      const offer = offers[index];
      if ((offer as any).savedCalculationPreview || offer.market !== "japan" || offer.catalogPricingMode !== "seller" || !offer.id) continue;
      try {
        if(offer.sourceId==='ajes_japan_feed') {
          // select * already supplied this record. Never refetch one detail per card.
          const parameters=japanPreviewParameters(offer as VehicleOffer);
          const fresh=await calculateOfferWithCustomerParametersDetailed(offer as VehicleOffer,parameters);
          if(fresh.ok && Number(fresh.calculation.totalRub)>0)result[index]={...offer,japanDeliveredPreview:{totalRub:fresh.calculation.totalRub,currencyRate:fresh.calculation.currencyRate,deliveryPricingBasis:fresh.calculation.deliveryPricingBasis,engineCc:parameters.engineCc,estimated:true,japanExportRestriction:assessJapanExportRestriction(offer)}};
          continue;
        }
        if(isGreenCornerOffer(offer)) {
          const quote = await greenPreview(offer as VehicleOffer, JSON.stringify([configuration, new Date().toISOString().slice(0,10)]));
          if (quote) result[index] = {...offer, japanDeliveredPreview: quote};
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
const searchQuotes = new DetailReadCache<Record<string, any>>({maxEntries:2,maxBytes:24*1024*1024,ttlMs:86400_000,concurrency:1});
const inputHashes=new WeakMap<JapanPreviewInputIndex,string>();
export function japanQuoteCacheKey(index:JapanPreviewInputIndex,configuration:unknown,rates:unknown,version:string,day:string){
  let inputHash=inputHashes.get(index);
  if(!inputHash){inputHash=createHash('sha256').update(JSON.stringify(index)).digest('hex');inputHashes.set(index,inputHash);}
  return createHash('sha256').update(JSON.stringify([inputHash,configuration,rates,version,day])).digest('hex');
}
export async function japanSearchContext(generationId:string){
  const { getEffectiveMarketVersion } = await import("../effective-market-settings");
  // Inputs remain independently refreshable every minute. Only exact unchanged
  // input/rate/settings/day/calculator combinations retain expensive quotes.
  const [index,configuration,rates,editorial]=await Promise.all([readJapanPreviewInputs(),getEffectiveMarketVersion("japan"),catalogRateFingerprintInputs(),readCatalogEditorial()]);
  if(index?.version!==1 || index.generationId!==generationId)return null;
  return {index,editorial,key:japanQuoteCacheKey(index,configuration,rates,calculationCacheVersion()+editorial.revision,new Date().toISOString().slice(0,10))};
}
export async function japanSearchQuotes(generationId: string) {
  const context=await japanSearchContext(generationId);
  if(!context)return {};
  const {index,key,editorial}=context;
  return searchQuotes.get(key,async()=>{
    const quotes:Record<string,any>={};
    const entries=Object.entries(index.entries);
    for(let start=0;start<entries.length;start+=64){
      await Promise.all(entries.slice(start,start+64).map(async([id,entry])=>{
        if(!entry.parameters)return;
        const offer=applyCatalogEditorial(entry.offer as VehicleOffer,editorial);
        const result=await calculateOfferWithCustomerParametersDetailed(offer,entry.parameters);
        if(result.ok && Number(result.calculation.totalRub)>0) quotes[id]={
          updatedAt:entry.updatedAt,sourcePrice:offer.sourcePrice,sourceCurrency:offer.sourceCurrency,
          totalRub:result.calculation.totalRub,currencyRate:result.calculation.currencyRate,deliveryPricingBasis:result.calculation.deliveryPricingBasis,
          engineCc:entry.parameters.engineCc,estimated:true,japanExportRestriction:entry.restriction};
      }));
      await new Promise(resolve=>setTimeout(resolve,0));
    }
    if((await japanSearchContext(generationId))?.key!==key)throw new Error('japan_quote_context_changed');
    return quotes;
  });
}
export async function attachJapanSearchValues<T extends {id:string;market:string;updatedAt?:string;sourcePrice?:number|null;sourceCurrency?:string|null}>(rows:T[], generationId:string):Promise<T[]> {
  rows=await withCurrentDepositCosts(rows);
  if(!rows.some(row=>row.market==="japan"))return rows;
  const quotes=await japanSearchQuotes(generationId);
  return rows.map(row=>{
    const quote=quotes[row.id];
    return row.market==="japan" && quote && matchesJapanPreviewInput(quote,row as any)
      ? {...row,japanDeliveredPreview:quote} : row;
  });
}
