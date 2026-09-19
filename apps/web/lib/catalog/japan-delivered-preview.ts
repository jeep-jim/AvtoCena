import { assessJapanExportRestriction } from "./japan-export-restriction";
import { unstable_cache } from "next/cache";
import { getOfferForPage } from "./offer-page-data";
import { japanPreviewParameters } from "./japan-preview-parameters";
import { calculateOfferWithCustomerParametersDetailed } from "./customs-pricing";
import { readDataJson } from "../data";
import { catalogGenerationId } from "./storage";
import { DetailReadCache } from "./detail-read-cache";
import { japanPreviewInputPath, matchesJapanPreviewInput, type JapanPreviewInputIndex } from "./japan-preview-inputs";
import type { VehicleOffer } from "./types";

const inputs = new DetailReadCache<JapanPreviewInputIndex | null>({maxEntries:2,maxBytes:16*1024*1024,ttlMs:60_000,concurrency:1});
async function readInputs() {
  const generationId = await catalogGenerationId();
  return inputs.get(generationId, () => readDataJson<JapanPreviewInputIndex | null>(japanPreviewInputPath(generationId),null));
}
const preview = unstable_cache(async (id: string, _revision: string, generationId: string, updatedAt: string, sourcePrice: number | null, sourceCurrency: string | null) => {
  const index = await readInputs().catch(()=>null);
  const entry = index?.version===1 && index.generationId===generationId ? index.entries?.[id] : undefined;
  if(entry && matchesJapanPreviewInput(entry,{updatedAt,sourcePrice,sourceCurrency})) {
    if(!entry.parameters)return null;
    const result = await calculateOfferWithCustomerParametersDetailed(entry.offer as VehicleOffer,entry.parameters);
    return result.ok && Number(result.calculation.totalRub)>0
      ? {totalRub:result.calculation.totalRub,engineCc:entry.parameters.engineCc,estimated:true,japanExportRestriction:entry.restriction} : null;
  }
  // Missing/old derived index retains the authoritative full-record path.
  const offer = await getOfferForPage(id);
  if (!offer || offer.market !== "japan" || offer.catalogPricingMode !== "seller") return null;
  let parameters;
  try { parameters = japanPreviewParameters(offer); } catch { return null; }
  const result = await calculateOfferWithCustomerParametersDetailed(offer, parameters);
  return result.ok && Number(result.calculation.totalRub) > 0
    ? { totalRub: result.calculation.totalRub, engineCc: parameters.engineCc, estimated: true, japanExportRestriction: assessJapanExportRestriction(offer) } : null;
}, ["japan-delivered-preview-v6-no-city-delivery"], { revalidate: 900 });

export async function attachJapanDeliveredPreviews<T extends Partial<VehicleOffer>>(offers: T[], configuration: unknown): Promise<T[]> {
  const result = [...offers];
  const generationId = offers.some(o=>o.market==="japan" && o.catalogPricingMode==="seller") ? await catalogGenerationId() : "";
  let cursor = 0;
  // Only visible cards, bounded storage/calculation concurrency, no browser fan-out.
  await Promise.all(Array.from({ length: Math.min(4, offers.length) }, async () => {
    while (cursor < offers.length) {
      const index = cursor++;
      const offer = offers[index];
      if (offer.market !== "japan" || offer.catalogPricingMode !== "seller" || !offer.id) continue;
      try {
        const quote = await preview(offer.id, JSON.stringify([offer.updatedAt, offer.sourcePrice, configuration, new Date().toISOString().slice(0, 10)]), generationId, offer.updatedAt || "", offer.sourcePrice ?? null, offer.sourceCurrency ?? null);
        if (quote) result[index] = { ...offer, japanExportRestriction: quote.japanExportRestriction, japanDeliveredPreview: quote };
      } catch { /* A failed estimate preserves the explicitly labelled source price. */ }
    }
  }));
  return result;
}
