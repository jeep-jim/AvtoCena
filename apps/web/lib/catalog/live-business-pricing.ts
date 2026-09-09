import { confirmedProductionValue } from "./production-month";
import { calculateRussiaCustomsForIndividual } from "../../../../packages/engine/src/calculation/russiaCustomsV2";
import { getEffectiveMarketsWithDefaults, getEffectiveMarketVersion } from "../effective-market-settings";
import { calculateAvtocenaFromBusinessConfig } from "../../../../packages/engine/src/calculation/calculateAvtocena";
import { applyEncyclopediaDisplayIdentity, applyEncyclopediaDisplayIdentityBatch } from "./display-identity";
import { resolveCatalogMarketConfig } from "./estimated-market-config";
import { convertToRub } from "./rates";
import type { CatalogMarket, VehicleOffer } from "./types";

function positive(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function snapshotSourcePriceRub(offer: Partial<VehicleOffer>) {
  return positive(offer.calculationSnapshot?.currencyRate?.sourcePriceRub)
    || positive(offer.calculationSnapshot?.sourcePriceRub)
    || positive(offer.calculationSnapshot?.customsValue?.vehiclePriceRub);
}

function snapshotCustomsParts(offer: Partial<VehicleOffer>) {
  const customs = offer.calculationSnapshot?.customs;
  const total = positive(customs?.totalCustomsRub);
  const utilizationFeeRub = positive(customs?.utilizationFeeRub);
  const customsRub = positive(customs?.knownCustomsRub)
    || Math.max(0, total - utilizationFeeRub);
  return { customsRub, utilizationFeeRub, total: customsRub + utilizationFeeRub || total };
}

function uniqueText(values: unknown[]) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

// Older published V2 quotes predate customsInput. Restore only their audited
// production reference and successful customs evidence; incomplete offers stay incomplete.
function withReplayInputs<T extends Partial<VehicleOffer>>(offer: T): T {
  const snapshot = offer.calculationSnapshot;
  const customs = snapshot?.customs;
  if (!snapshot || snapshot.customsInput || customs?.status !== "ready" || !customs.productionReferenceDate || snapshot.missing?.length || snapshot.priceIncludesAllCustoms === false) return offer;
  const productionDate = confirmedProductionValue(offer) || String(offer.year || customs.productionReferenceDate.slice(0,4));
  return {...offer, calculationSnapshot:{...snapshot,customsInput:{
    customsValueRub:customs.customsValueRub, eurRateRub:snapshot.eurRate?.effectiveRate,
    productionDate, engineCc:offer.engineCc, powerHp:offer.powerHp, powerKw:offer.powerKw,
    icePowerKw:offer.icePowerKw, power30MinKw:offer.power30MinKw, power30MinKwByMotor:offer.power30MinKwByMotor,
    utilizationPowerKw:customs.utilizationPowerKw, powertrainKind:offer.powertrainKind, fuel:offer.fuel,
    vehicleCategory:customs.vehicleCategoryAssumed ? undefined : customs.vehicleCategory,
    bodyType:offer.bodyType,make:offer.make,model:offer.model,tnVedCode:offer.tnVedCode,
    grossVehicleWeightKg:offer.grossVehicleWeightKg,n1IceFuel:offer.n1IceFuel,
    personalUseEligible:offer.personalUseEligible,
  }}} as T;
}

async function attachCurrentCurrencyRate<T extends Partial<VehicleOffer>>(offer: T): Promise<T> {
  if (String(offer.market || "") === "japan") return offer;
  const sourcePrice = positive(offer.sourcePrice);
  const sourceCurrency = String(offer.sourceCurrency || "").trim().toUpperCase();
  if (!sourcePrice || !sourceCurrency) return offer;

  const storedRate = offer.calculationSnapshot?.currencyRate;
  if (!offer.calculationSnapshot?.customsInput && snapshotSourcePriceRub(offer) > 0 && positive(storedRate?.effectiveRate) > 0) return offer;

  const [rate,eurRate] = await Promise.all([convertToRub(sourcePrice, sourceCurrency).catch(() => null),convertToRub(1,"EUR").catch(() => null)]);
  const fresh = (item:any) => item && ["cbr","cbr_live"].includes(item.rateSource) && Number.isFinite(Date.parse(item.rateDate)) && Math.abs(Date.now()-Date.parse(item.rateDate)) <= 4*86400000;
  if (!rate && !offer.calculationSnapshot?.customsInput) return offer;
  if (offer.calculationSnapshot?.customsInput && (!fresh(rate) || !fresh(eurRate))) return {...offer,totalRub:null,calculationStatus:"needs_currency_rate",calculationSnapshot:{...offer.calculationSnapshot,missing:["fresh_official_currency_rates"],priceIncludesAllCustoms:false}} as T;

  if (!rate) return offer;
  return {
    ...offer,
    calculationSnapshot: {
      ...(offer.calculationSnapshot || {}),
      currencyRate: rate,
      sourcePriceRub: rate.sourcePriceRub,
      ...(offer.calculationSnapshot?.customsInput ? {eurRate,customsInput:{...offer.calculationSnapshot.customsInput,
        customsValueRub:rate.sourcePriceRub,eurRateRub:eurRate!.effectiveRate}} : {}),
    },
  } as T;
}

export function repriceOfferWithBusinessConfig<T extends Partial<VehicleOffer>>(offer: T, configured: any): T {
  const market = String(offer.market || "") as CatalogMarket;
  if (!market) return offer;
  // Japan contains completed auction results. Their published price is a
  // historical snapshot and must not move with today's exchange rate.
  if (market === "japan") return {
    ...offer,
    previousTotalRub: null,
    priceDeltaRub: null,
    priceChangedAt: undefined,
  } as T;
  offer = withReplayInputs(offer);
  let snapshot = offer.calculationSnapshot || {};
  const resolved = resolveCatalogMarketConfig(market, configured);
  if (offer.transportToBorderRub != null && Number.isFinite(offer.transportToBorderRub) && offer.transportToBorderRub >= 0 && snapshot.customsInput?.vehicleCategory === "N1") resolved.config = {...resolved.config,logisticsRub:offer.transportToBorderRub};
  // Replay the exact inputs saved by the shared engine: a tariff anniversary or
  // changed N1 freight costs must not leave the previous customs amount frozen.
  if (snapshot.customsInput && snapshot.customs?.status === "ready" && !snapshot.missing?.length && snapshot.priceIncludesAllCustoms !== false) {
    const inputs = {...snapshot.customsInput, customsValueRub:snapshotSourcePriceRub(offer), importedAt:new Date()};
    const commercial = inputs.vehicleCategory === "N1" || String(inputs.tnVedCode || "").replace(/\D/g, "").startsWith("8704");
    if (commercial) inputs.customsValueRub = snapshotSourcePriceRub(offer) + Number(resolved.config.logisticsRub || 0);
    const customs = calculateRussiaCustomsForIndividual(inputs);
    snapshot = {...snapshot,customs,customsInput:inputs,missing:customs.missing,customsCompleteness:customs.status,
      customsValue:{...snapshot.customsValue,vehiclePriceRub:snapshotSourcePriceRub(offer),totalRub:inputs.customsValueRub,...(commercial ? {transportToBorderRub:resolved.config.logisticsRub,transportExcludedFromCustomsValueRub:0} : {})},
      warnings:uniqueText([...(snapshot.warnings || []),...customs.warnings]),
      priceIncludesAllCustoms:customs.status === "ready",priceIncludesUtilizationFee:customs.status === "ready"};
    offer = {...offer,calculationSnapshot:snapshot} as T;
    if (customs.status !== "ready") return {...offer,totalRub:null,calculationStatus:"needs_customs_data"} as T;
  }
  if (snapshot.customs?.status !== "ready" || snapshot.priceIncludesAllCustoms === false || snapshot.priceIncludesUtilizationFee === false || snapshot.missing?.length) return offer;
  const sourcePriceRub = snapshotSourcePriceRub(offer);
  const customs = snapshotCustomsParts(offer);
  if (!sourcePriceRub || !customs.total) return offer;

  const calculation = calculateAvtocenaFromBusinessConfig({
    marketId: market,
    marketConfig: resolved.config,
    sourcePriceRub,
    customsRub: customs.customsRub,
    utilizationFeeRub: customs.utilizationFeeRub,
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
    priceMode: (resolved.estimated || oldSnapshot.customs?.ageEstimated) && offer.priceMode !== "auction_start" ? "estimated" : offer.priceMode,
    calculationStatus: offer.priceMode === "auction_start"
      ? "auction_start"
      : resolved.estimated || oldSnapshot.pricingConfidence === "estimated" || oldSnapshot.customs?.ageEstimated
        ? "estimated"
        : "ready",
    calculationSnapshot: {
      ...oldSnapshot,
      ...calculation.snapshot,
      currencyRate: oldSnapshot.currencyRate,
      sourcePriceRub: oldSnapshot.sourcePriceRub || oldSnapshot.currencyRate?.sourcePriceRub,
      customs: oldSnapshot.customs,
      customsValue: oldSnapshot.customsValue,
      customsCompleteness: oldSnapshot.customsCompleteness,
      powerConfidence: oldSnapshot.powerConfidence,
      powerSource: oldSnapshot.powerSource,
      vehicleKnowledge: oldSnapshot.vehicleKnowledge,
      pricingConfidence: resolved.estimated || oldSnapshot.customs?.ageEstimated ? "estimated" : oldSnapshot.pricingConfidence || "exact",
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
  const rated = await attachCurrentCurrencyRate(withReplayInputs(offer));
  const configured = await getEffectiveMarketVersion(String(rated.market));
  const repriced = repriceOfferWithBusinessConfig(rated, configured);
  return await applyEncyclopediaDisplayIdentity(repriced as any) as T;
}

export async function applyActiveBusinessPricingBatch<T extends Partial<VehicleOffer>>(offers: T[]): Promise<T[]> {
  if (!offers.length) return offers;
  const [markets, ratedOffers] = await Promise.all([
    getEffectiveMarketsWithDefaults(),
    Promise.all(offers.map((offer) => attachCurrentCurrencyRate(withReplayInputs(offer)))),
  ]);
  const configs = new Map(markets.map((market) => [market.id, market.effectiveVersion || null]));
  const repriced = ratedOffers.map((offer) => repriceOfferWithBusinessConfig(offer, configs.get(String(offer.market))));
  return await applyEncyclopediaDisplayIdentityBatch(repriced as any[]) as T[];
}
