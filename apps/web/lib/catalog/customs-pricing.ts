import { getActiveMarketVersion } from "../business-settings";
import { calculateAvtocenaFromBusinessConfig } from "../../../../packages/engine/src/calculation/calculateAvtocena";
import { calculateRussiaCustomsForIndividual } from "../../../../packages/engine/src/calculation/russiaCustoms";
import { resolveCatalogMarketConfig } from "./estimated-market-config";
import { enrichOfferWithExplicitEngineDisplacement } from "./explicit-engine-displacement";
import { enrichOfferWithPowerKnowledge } from "./power-knowledge";
import { enrichOfferWithCertifiedPower } from "./power-reference";
import { preferExplicitCombustionPowertrain } from "./powertrain-safety";
import { convertToRub } from "./rates";
import { normalizeVehicleOfferSpecs } from "./spec-normalization";
import type { VehicleOffer } from "./types";
import { enrichOfferWithVehicleKnowledge } from "./vehicle-knowledge";

function positive(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function transportToBorderRub(offer: VehicleOffer) {
  const raw: any = offer.operational?.raw || {};
  return positive(raw.transportToBorderRub)
    || positive(raw.deliveryToBorderRub)
    || positive(raw.freightToBorderRub)
    || positive(raw.customsTransportRub);
}

function customsValueSnapshot(rate: any, borderTransportRub: number, customsValueRub: number) {
  return {
    vehiclePriceRub: rate.sourcePriceRub,
    transportToBorderRub: borderTransportRub,
    totalRub: customsValueRub,
  };
}

function hasTrustedPowerProvenance(offer: VehicleOffer) {
  const confidence = String(offer.powerDataConfidence || "");
  const source = String(offer.powerDataSource || "").toLocaleLowerCase("en-US");
  const raw: any = offer.operational?.raw || {};
  const variantSourceType = String(raw.vehicleKnowledgeVariant?.sourceType || "");
  return (["documented", "source_exact"].includes(confidence) && !source.includes("estimated"))
    || Boolean(raw.certifiedPowerReference)
    || ["manufacturer", "official_registry"].includes(variantSourceType);
}

function documentedMotorPower(offer: VehicleOffer) {
  if (!hasTrustedPowerProvenance(offer)) return 0;
  const byMotor = Array.isArray(offer.power30MinKwByMotor)
    ? offer.power30MinKwByMotor.map(positive).filter(Boolean)
    : [];
  return positive(offer.power30MinKw) || (byMotor.length ? byMotor.reduce((sum, value) => sum + value, 0) : 0);
}

function hasTrustedUtilizationPower(offer: VehicleOffer) {
  return positive(offer.utilizationPowerKw) > 0 && hasTrustedPowerProvenance(offer);
}

function exactUtilizationPowerProblem(offer: VehicleOffer) {
  const kind = String(offer.powertrainKind || "");
  if (!["electric", "series_hybrid", "other_hybrid"].includes(kind)) return null;

  // Готовое utilizationPowerKw допускается только из точного источника или сертифицированной
  // базы модели/модификации. Старые оценочные значения и пиковая мощность удаляются.
  if (hasTrustedUtilizationPower(offer)) return null;

  const motor30MinKw = documentedMotorPower(offer);
  if ((kind === "electric" || kind === "series_hybrid") && !motor30MinKw) {
    return {
      missing: ["certified_30_minute_power_kw"],
      warning: "Для точного утильсбора нужна максимальная 30-минутная мощность тяговых электромоторов из ОТТС, СБКТС, ЗОЕТС, ЭПТС, CoC или официального документа производителя. Пиковая мощность не подставляется.",
    };
  }

  if (kind === "other_hybrid" && (!positive(offer.icePowerKw) || !motor30MinKw)) {
    return {
      missing: [
        ...(!positive(offer.icePowerKw) ? ["ice_power_kw"] : []),
        ...(!motor30MinKw ? ["certified_30_minute_power_kw"] : []),
      ],
      warning: "Для точного утильсбора гибрида нужны мощность ДВС и максимальная 30-минутная мощность всех тяговых электромоторов. Пиковая или системная мощность вместо них не используется.",
    };
  }

  return null;
}

export async function calculateOfferWithRussiaCustoms(input: VehicleOffer): Promise<VehicleOffer> {
  const canonical = await enrichOfferWithVehicleKnowledge(enrichOfferWithExplicitEngineDisplacement(input));
  const certified = await enrichOfferWithCertifiedPower(canonical);
  const known = await enrichOfferWithPowerKnowledge(certified);
  const normalized = preferExplicitCombustionPowertrain(normalizeVehicleOfferSpecs(known) as VehicleOffer) as VehicleOffer;
  const electrified = ["electric", "series_hybrid", "other_hybrid"].includes(String(normalized.powertrainKind || ""));
  const offer = electrified && positive(normalized.utilizationPowerKw) && !hasTrustedUtilizationPower(normalized)
    ? { ...normalized, utilizationPowerKw: undefined }
    : normalized;

  const utilizationProblem = exactUtilizationPowerProblem(offer);
  if (utilizationProblem) {
    return {
      ...offer,
      totalRub: null,
      calculationStatus: "needs_utilization_power",
      calculationSnapshot: {
        ...(offer.calculationSnapshot || {}),
        pricingConfidence: "unavailable",
        certified30MinutePowerMissing: true,
        missing: utilizationProblem.missing,
        warnings: [utilizationProblem.warning],
      },
    };
  }

  if (!positive(offer.powerHp)) {
    return {
      ...offer,
      totalRub: null,
      calculationStatus: "needs_power_data",
      calculationSnapshot: {
        ...(offer.calculationSnapshot || {}),
        pricingConfidence: "unavailable",
        missing: ["power_hp"],
        warnings: ["Автомобиль не публикуется, пока мощность не найдена в объявлении или базе модели/модификации."],
      },
    };
  }

  const [rate, eurRate] = await Promise.all([
    convertToRub(offer.sourcePrice, offer.sourceCurrency),
    convertToRub(1, "EUR"),
  ]);
  if (!rate || !eurRate) {
    return {
      ...offer,
      totalRub: null,
      calculationStatus: "needs_currency_rate",
      calculationSnapshot: {
        ...(offer.calculationSnapshot || {}),
        currencyRate: rate,
        customs: { status: "needs_data", missing: rate ? ["eur_rate"] : ["source_currency_rate"] },
        pricingConfidence: "unavailable",
      },
    };
  }

  const borderTransportRub = transportToBorderRub(offer);
  const customsValueRub = rate.sourcePriceRub + borderTransportRub;
  const customs = calculateRussiaCustomsForIndividual({
    customsValueRub,
    eurRateRub: Number(eurRate.effectiveRate || 0),
    engineCc: offer.engineCc,
    powerHp: offer.powerHp,
    powerKw: offer.powerKw,
    icePowerKw: offer.icePowerKw,
    power30MinKw: documentedMotorPower(offer) ? offer.power30MinKw : undefined,
    power30MinKwByMotor: documentedMotorPower(offer) && Array.isArray(offer.power30MinKwByMotor) ? offer.power30MinKwByMotor : undefined,
    utilizationPowerKw: hasTrustedUtilizationPower(offer) ? offer.utilizationPowerKw : undefined,
    powertrainKind: offer.powertrainKind,
    productionDate: offer.productionDate,
    year: offer.year,
    fuel: offer.fuel,
  });

  const configured: any = await getActiveMarketVersion(offer.market);
  const market = resolveCatalogMarketConfig(offer.market, configured);

  if (customs.status !== "ready" || customs.totalCustomsRub === undefined) {
    return {
      ...offer,
      totalRub: null,
      calculationSnapshot: {
        currencyRate: rate,
        customs,
        customsValue: customsValueSnapshot(rate, borderTransportRub, customsValueRub),
        customsCompleteness: customs.status,
        marketConfigStatus: configured?.status || "missing",
        pricingConfidence: "unavailable",
        estimatedMarketFields: market.estimatedFields,
        certified30MinutePowerMissing: customs.missing.includes("certified_30_minute_power_kw"),
        warnings: [...market.warnings, ...customs.warnings],
      },
      calculationStatus: "needs_customs_data",
    };
  }

  const calculation = calculateAvtocenaFromBusinessConfig({
    marketId: offer.market,
    marketConfig: market.config,
    sourcePriceRub: rate.sourcePriceRub,
    customsRub: customs.totalCustomsRub,
  });

  const powerEstimated = ["reference", "estimated"].includes(String(offer.powerDataConfidence || ""));
  const priceEstimated = market.estimated || powerEstimated || customs.ageEstimated || offer.priceMode === "estimated";
  const warnings = [
    ...market.warnings,
    ...customs.warnings,
    ...(powerEstimated ? ["Мощность подставлена по базе модели/модификации и должна быть подтверждена менеджером по конкретному автомобилю."] : []),
  ];

  return {
    ...offer,
    priceMode: priceEstimated && offer.priceMode !== "auction_start" ? "estimated" : offer.priceMode,
    totalRub: calculation.totalRub,
    calculationSnapshot: {
      ...calculation.snapshot,
      currencyRate: rate,
      customs,
      customsValue: customsValueSnapshot(rate, borderTransportRub, customsValueRub),
      customsCompleteness: customs.status,
      pricingConfidence: priceEstimated ? "estimated" : "exact",
      estimatedMarketFields: market.estimatedFields,
      powerConfidence: offer.powerDataConfidence,
      powerSource: offer.powerDataSource,
      certified30MinutePowerMissing: false,
      vehicleKnowledge: (offer.operational?.raw as any)?.vehicleKnowledgeModel || null,
      warnings,
    },
    calculationStatus: offer.priceMode === "auction_start"
      ? "auction_start"
      : priceEstimated
        ? "estimated"
        : "ready",
  };
}
