import { getActiveMarketVersion } from "../business-settings";
import { calculateAvtocenaFromBusinessConfig } from "../../../../packages/engine/src/calculation/calculateAvtocena";
import { calculateRussiaCustomsForIndividual } from "../../../../packages/engine/src/calculation/russiaCustoms";
import { resolveCatalogMarketConfig } from "./estimated-market-config";
import { preferExplicitCombustionPowertrain } from "./powertrain-safety";
import { convertToRub } from "./rates";
import { normalizeVehicleOfferSpecs } from "./spec-normalization";
import type { VehicleOffer } from "./types";

function positive(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function sourceExactPower(offer: VehicleOffer) {
  return ["source_exact", "documented"].includes(text(offer.powerDataConfidence));
}

function documentedMotorPower(offer: VehicleOffer) {
  if (!sourceExactPower(offer)) return 0;
  const byMotor = Array.isArray(offer.power30MinKwByMotor)
    ? offer.power30MinKwByMotor.map(positive).filter(Boolean)
    : [];
  return positive(offer.power30MinKw) || (byMotor.length ? byMotor.reduce((sum, value) => sum + value, 0) : 0);
}

function sourceExactUtilizationPower(offer: VehicleOffer) {
  return sourceExactPower(offer) && positive(offer.utilizationPowerKw) > 0;
}

function sourceOnlyMarker(offer: VehicleOffer): VehicleOffer {
  return {
    ...offer,
    operational: {
      ...(offer.operational || {}),
      sourceOnlyCalculation: true,
      calculationInputSource: "exact_detail",
      knowledgeEnriched: false,
    },
  };
}

function pending(offer: VehicleOffer, status: string, rate: any, missing: string[], warnings: string[] = []) {
  return sourceOnlyMarker({
    ...offer,
    totalRub: null,
    calculationStatus: status,
    calculationSnapshot: {
      ...(offer.calculationSnapshot || {}),
      sourceOnly: true,
      vehicleKnowledge: null,
      pricingConfidence: "unavailable",
      ...(rate ? { currencyRate: rate, sourcePriceRub: rate.sourcePriceRub } : {}),
      missing,
      warnings,
    },
  });
}

export async function calculateOfferWithRussiaCustomsSourceOnly(input: VehicleOffer): Promise<VehicleOffer> {
  let offer = sourceOnlyMarker(
    preferExplicitCombustionPowertrain(normalizeVehicleOfferSpecs(input) as VehicleOffer) as VehicleOffer,
  );

  const sourcePrice = positive(offer.sourcePrice);
  if (!sourcePrice || !text(offer.sourceCurrency)) {
    return pending(offer, "needs_source_price", null, ["source_price", "source_currency"]);
  }

  const rate = await convertToRub(offer.sourcePrice, offer.sourceCurrency);
  if (!rate || !positive(rate.sourcePriceRub)) {
    return pending(offer, "needs_currency_rate", null, ["source_currency_rate"]);
  }

  if (!positive(offer.powerHp) || !sourceExactPower(offer)) {
    return pending(offer, "needs_power_data", rate, ["source_exact_power_hp"], [
      "Мощность должна быть взята из exact-карточки источника. База знаний и справочники не используются.",
    ]);
  }

  const kind = text(offer.powertrainKind);
  const electric = kind === "electric";
  const electrified = ["electric", "series_hybrid", "other_hybrid"].includes(kind);
  if (!electric && !positive(offer.engineCc)) {
    return pending(offer, "needs_engine_data", rate, ["source_exact_engine_cc"]);
  }

  const motor30 = documentedMotorPower(offer);
  if ((kind === "electric" || kind === "series_hybrid") && !sourceExactUtilizationPower(offer) && !motor30) {
    return pending(offer, "needs_utilization_power", rate, ["source_exact_30_minute_power_kw"], [
      "Для электромобиля/последовательного гибрида нужна 30-минутная мощность или готовая мощность для утильсбора из exact-карточки источника.",
    ]);
  }
  if (kind === "other_hybrid" && (!positive(offer.icePowerKw) || (!sourceExactUtilizationPower(offer) && !motor30))) {
    return pending(offer, "needs_utilization_power", rate, [
      ...(!positive(offer.icePowerKw) ? ["source_exact_ice_power_kw"] : []),
      ...(!sourceExactUtilizationPower(offer) && !motor30 ? ["source_exact_30_minute_power_kw"] : []),
    ]);
  }

  const eurRate = await convertToRub(1, "EUR");
  if (!eurRate || !positive(eurRate.effectiveRate)) {
    return pending(offer, "needs_currency_rate", rate, ["eur_rate"]);
  }

  const raw: any = offer.operational?.raw || {};
  const transportToBorderRub = positive(raw.transportToBorderRub)
    || positive(raw.deliveryToBorderRub)
    || positive(raw.freightToBorderRub)
    || positive(raw.customsTransportRub);
  const customsValueRub = positive(rate.sourcePriceRub) + transportToBorderRub;

  const customs = calculateRussiaCustomsForIndividual({
    customsValueRub,
    eurRateRub: positive(eurRate.effectiveRate),
    engineCc: offer.engineCc,
    powerHp: offer.powerHp,
    powerKw: offer.powerKw,
    icePowerKw: offer.icePowerKw,
    power30MinKw: motor30 ? offer.power30MinKw : undefined,
    power30MinKwByMotor: motor30 && Array.isArray(offer.power30MinKwByMotor) ? offer.power30MinKwByMotor : undefined,
    utilizationPowerKw: sourceExactUtilizationPower(offer) ? offer.utilizationPowerKw : undefined,
    powertrainKind: offer.powertrainKind,
    productionDate: offer.productionDate,
    year: offer.year,
    fuel: offer.fuel,
  });

  if (customs.status !== "ready" || !positive(customs.totalCustomsRub)) {
    return sourceOnlyMarker({
      ...offer,
      totalRub: null,
      calculationStatus: "needs_customs_data",
      calculationSnapshot: {
        ...(offer.calculationSnapshot || {}),
        sourceOnly: true,
        vehicleKnowledge: null,
        currencyRate: rate,
        sourcePriceRub: rate.sourcePriceRub,
        customs,
        customsValue: {
          vehiclePriceRub: rate.sourcePriceRub,
          transportToBorderRub,
          totalRub: customsValueRub,
        },
        customsCompleteness: customs.status,
        pricingConfidence: "unavailable",
        missing: customs.missing,
        warnings: customs.warnings,
      },
    });
  }

  const configured: any = await getActiveMarketVersion(offer.market);
  const market = resolveCatalogMarketConfig(offer.market, configured);
  const calculation = calculateAvtocenaFromBusinessConfig({
    marketId: offer.market,
    marketConfig: market.config,
    sourcePriceRub: rate.sourcePriceRub,
    customsRub: customs.totalCustomsRub,
  });

  const priceEstimated = market.estimated || customs.ageEstimated || offer.priceMode === "estimated";
  offer = sourceOnlyMarker({
    ...offer,
    priceMode: priceEstimated && offer.priceMode !== "auction_start" ? "estimated" : offer.priceMode,
    totalRub: calculation.totalRub,
    calculationStatus: offer.priceMode === "auction_start" ? "auction_start" : priceEstimated ? "estimated" : "ready",
    calculationSnapshot: {
      ...calculation.snapshot,
      sourceOnly: true,
      vehicleKnowledge: null,
      currencyRate: rate,
      sourcePriceRub: rate.sourcePriceRub,
      customs,
      customsValue: {
        vehiclePriceRub: rate.sourcePriceRub,
        transportToBorderRub,
        totalRub: customsValueRub,
      },
      customsCompleteness: customs.status,
      pricingConfidence: priceEstimated ? "estimated" : "exact",
      estimatedMarketFields: market.estimatedFields,
      powerConfidence: offer.powerDataConfidence,
      powerSource: offer.powerDataSource,
      warnings: [...market.warnings, ...customs.warnings],
    },
  });

  return offer;
}
