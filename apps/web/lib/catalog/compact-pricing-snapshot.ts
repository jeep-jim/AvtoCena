import { deliveryPricingBasis } from "./card-city-delivery";
import { japanServiceCostBasis } from "./japan-service-pricing";
import { che168GlobalPriceAdjustment } from "./china-owner-policy";
import { withReplayInputs } from "./pricing-replay-inputs";
import type { VehicleOffer } from './types';

// Retain only replay inputs and gate results, never source/raw tables or photos.
// This lets visible cards use the same engine as detail pages without N shard reads.
export function compactPricingSnapshot(offer: VehicleOffer) {
  offer = withReplayInputs(offer);
  const s = offer.calculationSnapshot;
  if (offer.market === 'japan') {
    const basis = japanServiceCostBasis(s);
    return basis ? {serviceCostBasis:basis,deliveryPricingBasis:deliveryPricingBasis(s)} : {};
  }
  if (!s?.customsInput) return {};
  const c = s.customs;
  return {
    deliveryPricingBasis: deliveryPricingBasis(s),
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

/** Keep list responses compact after replay; the full ledger belongs to detail. */
export function compactRepricedProjection<T extends Partial<VehicleOffer>>(offer: T): T {
  if (offer.market === 'japan' || Number((offer as any).cardProjectionVersion) < 3 || !(offer as any).cardProjectionVersion) return offer;
  const s = offer.calculationSnapshot;
  return {...offer, calculationSnapshot: {
    currencyRate: s?.currencyRate, pricingConfidence: s?.pricingConfidence,
    powerScenario: s?.powerScenario, powerRequiresConfirmation: s?.powerRequiresConfirmation,
    ...compactPricingSnapshot(offer as VehicleOffer),
  }} as T;
}
