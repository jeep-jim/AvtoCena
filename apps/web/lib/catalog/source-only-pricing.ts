import { getActiveMarketVersion } from "../business-settings";
import { calculateAvtocenaFromBusinessConfig } from "../../../../packages/engine/src/calculation/calculateAvtocena";
import { calculateRussiaCustomsForIndividual } from "../../../../packages/engine/src/calculation/russiaCustoms";
import { resolveCatalogMarketConfig } from "./estimated-market-config";
import { convertToRub } from "./rates";
import type { PowertrainKind, VehicleOffer } from "./types";

function positive(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function text(value: unknown) {
  return String(value ?? "").trim();
}

function exactFields(offer: VehicleOffer) {
  const operational: any = offer.operational || {};
  const raw: any = operational.raw || {};
  const list = Array.isArray(operational.sourceExactFields)
    ? operational.sourceExactFields
    : Array.isArray(raw.sourceExactFields)
      ? raw.sourceExactFields
      : [];
  return new Set(list.map((value: unknown) => text(value)).filter(Boolean));
}

function hasExact(offer: VehicleOffer, field: string) {
  return exactFields(offer).has(field);
}

function sourceExactPower(offer: VehicleOffer) {
  return hasExact(offer, "powerHp")
    && ["source_exact", "documented"].includes(text(offer.powerDataConfidence));
}

function documentedMotorPower(offer: VehicleOffer) {
  if (!["source_exact", "documented"].includes(text(offer.powerDataConfidence))) return 0;
  const byMotor = hasExact(offer, "power30MinKwByMotor") && Array.isArray(offer.power30MinKwByMotor)
    ? offer.power30MinKwByMotor.map(positive).filter(Boolean)
    : [];
  return (hasExact(offer, "power30MinKw") ? positive(offer.power30MinKw) : 0)
    || (byMotor.length ? byMotor.reduce((sum, value) => sum + value, 0) : 0);
}

function sourceExactUtilizationPower(offer: VehicleOffer) {
  return hasExact(offer, "utilizationPowerKw")
    && ["source_exact", "documented"].includes(text(offer.powerDataConfidence))
    && positive(offer.utilizationPowerKw) > 0;
}

function inferPowertrainFromExactFuel(offer: VehicleOffer): PowertrainKind {
  if (hasExact(offer, "powertrainKind") && offer.powertrainKind) return offer.powertrainKind;
  if (!hasExact(offer, "fuel")) return "unknown";
  const fuel = text(offer.fuel).toLowerCase();
  if (/electric|\bev\b|bev|전기|纯电|электр/.test(fuel) && !positive(offer.engineCc)) return "electric";
  if (/hybrid|phev|hev|하이브리드|混合动力|гибрид/.test(fuel)) return "other_hybrid";
  if (hasExact(offer, "engineCc") && positive(offer.engineCc)) return "combustion";
  return "unknown";
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

function strictExactInput(input: VehicleOffer): VehicleOffer {
  const fields = exactFields(input);
  const keep = <K extends keyof VehicleOffer>(field: K, value: VehicleOffer[K]) => fields.has(String(field)) ? value : undefined;
  const offer: VehicleOffer = {
    ...input,
    mileageKm: keep("mileageKm", input.mileageKm) as number | undefined,
    engineCc: keep("engineCc", input.engineCc) as number | undefined,
    engineType: keep("engineType", input.engineType) as string | undefined,
    fuel: keep("fuel", input.fuel) as string | undefined,
    transmission: keep("transmission", input.transmission) as string | undefined,
    drive: keep("drive", input.drive) as string | undefined,
    bodyType: keep("bodyType", input.bodyType) as string | undefined,
    powerHp: keep("powerHp", input.powerHp) as number | undefined,
    powerKw: keep("powerKw", input.powerKw) as number | undefined,
    icePowerKw: keep("icePowerKw", input.icePowerKw) as number | undefined,
    power30MinKw: keep("power30MinKw", input.power30MinKw) as number | undefined,
    power30MinKwByMotor: keep("power30MinKwByMotor", input.power30MinKwByMotor) as number[] | undefined,
    utilizationPowerKw: keep("utilizationPowerKw", input.utilizationPowerKw) as number | undefined,
    powerDataConfidence: fields.has("powerHp") || fields.has("power30MinKw") || fields.has("utilizationPowerKw")
      ? input.powerDataConfidence
      : undefined,
    powerDataSource: fields.has("powerHp") || fields.has("power30MinKw") || fields.has("utilizationPowerKw")
      ? input.powerDataSource
      : undefined,
  };
  offer.powertrainKind = inferPowertrainFromExactFuel(offer);
  return sourceOnlyMarker(offer);
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
  let offer = strictExactInput(input);

  if (!hasExact(offer, "sourcePrice") || !hasExact(offer, "sourceCurrency") || !positive(offer.sourcePrice) || !text(offer.sourceCurrency)) {
    return pending(offer, "needs_source_price", null, ["source_exact_price", "source_exact_currency"]);
  }

  const rate = await convertToRub(offer.sourcePrice, offer.sourceCurrency);
  if (!rate || !positive(rate.sourcePriceRub)) {
    return pending(offer, "needs_currency_rate", null, ["source_currency_rate"]);
  }

  if (!positive(offer.powerHp) || !sourceExactPower(offer)) {
    return pending(offer, "needs_power_data", rate, ["source_exact_power_hp"], [
      "Мощность должна быть взята из exact-карточки источника. База знаний, raw-инференс и модельные справочники не используются.",
    ]);
  }

  const kind = inferPowertrainFromExactFuel(offer);
  offer.powertrainKind = kind;
  const electric = kind === "electric";
  if (!electric && (!hasExact(offer, "engineCc") || !positive(offer.engineCc))) {
    return pending(offer, "needs_engine_data", rate, ["source_exact_engine_cc"]);
  }

  const motor30 = documentedMotorPower(offer);
  if ((kind === "electric" || kind === "series_hybrid") && !sourceExactUtilizationPower(offer) && !motor30) {
    return pending(offer, "needs_utilization_power", rate, ["source_exact_30_minute_power_kw"], [
      "Для электромобиля/последовательного гибрида нужна 30-минутная мощность или готовая мощность для утильсбора из exact-карточки источника.",
    ]);
  }
  if (kind === "other_hybrid" && ((!hasExact(offer, "icePowerKw") || !positive(offer.icePowerKw)) || (!sourceExactUtilizationPower(offer) && !motor30))) {
    return pending(offer, "needs_utilization_power", rate, [
      ...(!hasExact(offer, "icePowerKw") || !positive(offer.icePowerKw) ? ["source_exact_ice_power_kw"] : []),
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
