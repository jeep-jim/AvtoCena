import { che168GlobalPriceAdjustment } from "./china-owner-policy";
import { withReplayInputs } from "./pricing-replay-inputs";
import type { VehicleOffer } from './types';

// Retain only replay inputs and gate results, never source/raw tables or photos.
// This lets visible cards use the same engine as detail pages without N shard reads.
export function compactPricingSnapshot(offer: VehicleOffer) {
  offer = withReplayInputs(offer);
  const s = offer.calculationSnapshot;
  if (offer.market === 'japan' || !s?.customsInput) return {};
  const c = s.customs;
  return {
    customsInput: s.customsInput, eurRate: s.eurRate, sourcePriceRub: s.sourcePriceRub,
    missing: s.missing, priceIncludesAllCustoms: s.priceIncludesAllCustoms,
    priceIncludesUtilizationFee: s.priceIncludesUtilizationFee,
    sourcePriceAdjustment: che168GlobalPriceAdjustment(offer, Number(s.currencyRate?.sourcePriceRub || s.sourcePriceRub)) || s.sourcePriceAdjustment,
    customs: c ? { status: c.status, totalCustomsRub: c.totalCustomsRub,
      knownCustomsRub: c.knownCustomsRub, utilizationFeeRub: c.utilizationFeeRub,
      utilizationPowerKw: c.utilizationPowerKw, ageEstimated: c.ageEstimated,
      productionReferenceDate: c.productionReferenceDate, missing: c.missing } : undefined,
  };
}
