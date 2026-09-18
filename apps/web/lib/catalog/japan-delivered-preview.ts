import { assessJapanExportRestriction } from "./japan-export-restriction";
import { unstable_cache } from "next/cache";
import { getOfferForPage } from "./offer-page-data";
import { japanPreviewParameters } from "./japan-preview-parameters";
import { calculateOfferWithCustomerParametersDetailed } from "./customs-pricing";
import type { VehicleOffer } from "./types";

const preview = unstable_cache(async (id: string, _revision: string) => {
  const offer = await getOfferForPage(id);
  if (!offer || offer.market !== "japan" || offer.catalogPricingMode !== "seller") return null;
  let parameters;
  try { parameters = japanPreviewParameters(offer); } catch { return null; }
  const result = await calculateOfferWithCustomerParametersDetailed(offer, parameters);
  return result.ok && Number(result.calculation.totalRub) > 0
    ? { totalRub: result.calculation.totalRub, engineCc: parameters.engineCc, estimated: true, japanExportRestriction: assessJapanExportRestriction(offer) } : null;
}, ["japan-delivered-preview-v2"], { revalidate: 60 });

export async function attachJapanDeliveredPreviews<T extends Partial<VehicleOffer>>(offers: T[], configuration: unknown): Promise<T[]> {
  const result = [...offers];
  let cursor = 0;
  // Only visible cards, bounded storage/calculation concurrency, no browser fan-out.
  await Promise.all(Array.from({ length: Math.min(4, offers.length) }, async () => {
    while (cursor < offers.length) {
      const index = cursor++;
      const offer = offers[index];
      if (offer.market !== "japan" || offer.catalogPricingMode !== "seller" || !offer.id) continue;
      try {
        const quote = await preview(offer.id, JSON.stringify([offer.updatedAt, offer.sourcePrice, configuration, new Date().toISOString().slice(0, 10)]));
        if (quote) result[index] = { ...offer, japanExportRestriction: quote.japanExportRestriction, japanDeliveredPreview: quote };
      } catch { /* A failed estimate preserves the explicitly labelled source price. */ }
    }
  }));
  return result;
}
