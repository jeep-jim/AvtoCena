import { getActiveMarketVersion, getMarketsWithEffectiveVersions } from "../business-settings";
import { calculateAvtocenaFromBusinessConfig } from "../../../../packages/engine/src/calculation/calculateAvtocena";
import { resolveCatalogMarketConfig } from "./estimated-market-config";
import type { CatalogMarket, VehicleOffer } from "./types";

function positive(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function snapshotSourcePriceRub(offer: Partial<VehicleOffer>) {
  return positive(offer.calculationSnapshot?.currencyRate?.sourcePriceRub)
    || positive(offer.calculationSnapshot?.customsValue?.vehiclePriceRub);
}

function snapshotCustomsRub(offer: Partial<VehicleOffer>) {
  return positive(offer.calculationSnapshot?.customs?.totalCustomsRub);
}

function uniqueText(values: unknown[]) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

export function repriceOfferWithBusinessConfig<T extends Partial<VehicleOffer>>(offer: T, configured: any): T {
  const market = String(offer.market || "") as CatalogMarket;
  if (!market) return offer;
  const sourcePriceRub = snapshotSourcePriceRub(offer);
  const customsRub = snapshotCustomsRub(offer);
  if (!sourcePriceRub || !customsRub) return offer;

  const resolved = resolveCatalogMarketConfig(market, configured);
  const calculation = calculateAvtocenaFromBusinessConfig({
    marketId: market,
    marketConfig: resolved.config,
    sourcePriceRub,
    customsRub,
  });
  const previousTotal = positive(offer.totalRub);
  const changed = previousTotal > 0 && previousTotal !== calculation.totalRub;
  const oldSnapshot = offer.calculationSnapshot || {};
  const repricedAt = new Date().toISOString();

  return {
    ...offer,
    totalRub: calculation.totalRub,
    previousTotalRub: changed ? previousTotal : offer.previousTotalRub,
    priceDeltaRub: changed ? calculation.totalRub - previousTotal : offer.priceDeltaRub,
    priceChangedAt: changed ? repricedAt : offer.priceChangedAt,
    priceMode: resolved.estimated && offer.priceMode !== "auction_start" ? "estimated" : offer.priceMode,
    calculationStatus: offer.priceMode === "auction_start"
      ? "auction_start"
      : resolved.estimated
        ? "estimated"
        : "ready",
    calculationSnapshot: {
      ...oldSnapshot,
      ...calculation.snapshot,
      currencyRate: oldSnapshot.currencyRate,
      customs: oldSnapshot.customs,
      customsValue: oldSnapshot.customsValue,
      customsCompleteness: oldSnapshot.customsCompleteness,
      powerConfidence: oldSnapshot.powerConfidence,
      powerSource: oldSnapshot.powerSource,
      vehicleKnowledge: oldSnapshot.vehicleKnowledge,
      pricingConfidence: resolved.estimated ? "estimated" : oldSnapshot.pricingConfidence || "exact",
      estimatedMarketFields: resolved.estimatedFields,
      provisionalMarketConfig: Boolean(resolved.config?.provisional),
      businessConfigVersion: resolved.config?.id,
      businessRepricedAt: repricedAt,
      warnings: uniqueText([...(oldSnapshot.warnings || []), ...resolved.warnings]),
    },
  } as T;
}

export async function applyActiveBusinessPricing<T extends Partial<VehicleOffer>>(offer: T): Promise<T> {
  if (!offer.market) return offer;
  const configured = await getActiveMarketVersion(String(offer.market));
  return repriceOfferWithBusinessConfig(offer, configured);
}

export async function applyActiveBusinessPricingBatch<T extends Partial<VehicleOffer>>(offers: T[]): Promise<T[]> {
  if (!offers.length) return offers;
  const markets = await getMarketsWithEffectiveVersions();
  const configs = new Map(markets.map((market) => [market.id, market.effectiveVersion || null]));
  return offers.map((offer) => repriceOfferWithBusinessConfig(offer, configs.get(String(offer.market))));
}
