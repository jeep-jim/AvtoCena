import { getActiveMarketVersion } from "../business-settings";
import { calculateAvtocenaFromBusinessConfig } from "../../../../packages/engine/src/calculation/calculateAvtocena";
import { calculateRussiaCustomsForIndividual } from "../../../../packages/engine/src/calculation/russiaCustomsV2";
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

export function discardRepresentativeModelPowerForCustoms<T extends VehicleOffer>(offer: T): T {
  if (!String(offer.powerDataSource || "").startsWith("vehicle-model-representative:")) return offer;
  return {
    ...offer,
    powerHp: undefined,
    powerKw: undefined,
    powerDataConfidence: undefined,
    powerDataSource: undefined,
  } as T;
}

const activeMarketVersionCache = new Map<string, { pending: Promise<any>; expiresAt: number }>();

function getCalculationMarketVersion(market: string) {
  const key = String(market || "").trim();
  const now = Date.now();
  const cached = activeMarketVersionCache.get(key);
  if (cached && cached.expiresAt > now) return cached.pending;
  const ttlMs = Math.max(1_000, Number(process.env.CATALOG_MARKET_CONFIG_CACHE_MS || 10_000));
  const entry = {
    expiresAt: now + ttlMs,
    pending: Promise.resolve(null) as Promise<any>,
  };
  entry.pending = getActiveMarketVersion(key).catch((error) => {
      if (activeMarketVersionCache.get(key) === entry) activeMarketVersionCache.delete(key);
      throw error;
  });
  activeMarketVersionCache.set(key, entry);
  return entry.pending;
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
    transportExcludedFromCustomsValueRub: borderTransportRub,
    transportIncludedInCustomsValue: false,
    totalRub: customsValueRub,
  };
}

export function isOfficialCustomsCurrencyRate(rate: any) {
  return ["cbr", "cbr_live"].includes(String(rate?.rateSource || ""));
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

const PRELIMINARY_POWER_MISSING = new Set([
  "certified_30_minute_power_kw",
  "utilization_power_kw",
  "utilization_coefficient",
  "ice_power_kw",
  "electric_excise_power_kw",
  "power_hp",
]);

function isElectrifiedKind(value: unknown) {
  return ["electric", "series_hybrid", "other_hybrid"].includes(String(value || ""));
}

function onlyPowerDependentMissing(values: unknown) {
  const rows = Array.isArray(values) ? values.map(String).filter(Boolean) : [];
  return rows.length > 0 && rows.every((value) => PRELIMINARY_POWER_MISSING.has(value));
}

export function isPreliminaryPowerPendingCalculation(offer: Partial<VehicleOffer> | any) {
  const snapshot = offer?.calculationSnapshot || {};
  const customs = snapshot.customs || {};
  return ["combustion", "electric", "series_hybrid", "other_hybrid"].includes(String(offer?.powertrainKind || ""))
    && String(offer?.calculationStatus || "") === "preliminary_power_pending"
    && positive(offer?.totalRub) > 0
    && snapshot.pricingConfidence === "preliminary"
    && snapshot.priceIncludesUtilizationFee === false
    && customs.status === "needs_data"
    && onlyPowerDependentMissing(snapshot.missing || customs.missing);
}

export function isPreliminaryElectrifiedCalculation(offer: Partial<VehicleOffer> | any) {
  return isElectrifiedKind(offer?.powertrainKind) && isPreliminaryPowerPendingCalculation(offer);
}

async function calculateOfferWithRussiaCustomsInternal(input: VehicleOffer, allowCombustionPreliminary: boolean): Promise<VehicleOffer> {
  const canonical = discardRepresentativeModelPowerForCustoms(
    await enrichOfferWithVehicleKnowledge(enrichOfferWithExplicitEngineDisplacement(input)),
  );
  const certified = await enrichOfferWithCertifiedPower(canonical);
  const known = await enrichOfferWithPowerKnowledge(certified);
  const normalized = preferExplicitCombustionPowertrain(normalizeVehicleOfferSpecs(known) as VehicleOffer) as VehicleOffer;
  const electrified = isElectrifiedKind(normalized.powertrainKind);
  const offer = electrified && positive(normalized.utilizationPowerKw) && !hasTrustedUtilizationPower(normalized)
    ? { ...normalized, utilizationPowerKw: undefined }
    : normalized;

  const rate = await convertToRub(offer.sourcePrice, offer.sourceCurrency);
  if (!rate) {
    return {
      ...offer,
      totalRub: null,
      calculationStatus: "needs_currency_rate",
      calculationSnapshot: {
        ...(offer.calculationSnapshot || {}),
        pricingConfidence: "unavailable",
        customs: { status: "needs_data", missing: ["source_currency_rate"] },
      },
    };
  }
  if (!isOfficialCustomsCurrencyRate(rate)) {
    return {
      ...offer,
      totalRub: null,
      calculationStatus: "needs_currency_rate",
      calculationSnapshot: {
        ...(offer.calculationSnapshot || {}),
        currencyRate: rate,
        sourcePriceRub: rate.sourcePriceRub,
        pricingConfidence: "unavailable",
        customs: { status: "needs_data", missing: ["official_source_currency_rate"] },
        warnings: ["Для точного таможенного расчёта нужен официальный курс Банка России. Биржевой или резервный курс не используется как таможенный."],
      },
    };
  }

  const pendingSnapshot = {
    ...(offer.calculationSnapshot || {}),
    currencyRate: rate,
    sourcePriceRub: rate.sourcePriceRub,
  };

  // Missing ordinary combustion power still blocks a calculated public price.
  // Electrified vehicles are different: missing short-term/utilization power may
  // produce a clearly marked preliminary lower-bound instead of disappearing.
  if (!electrified && !positive(offer.powerHp) && !allowCombustionPreliminary) {
    return {
      ...offer,
      totalRub: null,
      calculationStatus: "needs_power_data",
      calculationSnapshot: {
        ...pendingSnapshot,
        pricingConfidence: "unavailable",
        missing: ["power_hp"],
        warnings: ["Автомобиль не публикуется как рассчитанный, пока мощность не найдена в объявлении или базе модели/модификации. Рублёвый эквивалент цены источника при этом сохраняется."],
      },
    };
  }

  const eurRate = await convertToRub(1, "EUR");
  if (!eurRate || !isOfficialCustomsCurrencyRate(eurRate)) {
    return {
      ...offer,
      totalRub: null,
      calculationStatus: "needs_currency_rate",
      calculationSnapshot: {
        ...pendingSnapshot,
        eurRate: eurRate || undefined,
        customs: { status: "needs_data", missing: ["official_eur_rate"] },
        pricingConfidence: "unavailable",
        warnings: ["Для единой ставки таможенных платежей нужен официальный курс евро Банка России."],
      },
    };
  }

  const borderTransportRub = transportToBorderRub(offer);
  // For an individual's personal-use vehicle, transport/insurance to the border
  // is not automatically added to the customs value. Keep it visible in the
  // audit snapshot but calculate the customs base from the vehicle value itself.
  const customsValueRub = rate.sourcePriceRub;
  const motor30MinKnown = documentedMotorPower(offer) > 0;
  const customs = calculateRussiaCustomsForIndividual({
    customsValueRub,
    eurRateRub: Number(eurRate.effectiveRate || 0),
    engineCc: offer.engineCc,
    powerHp: offer.powerHp,
    powerKw: offer.powerKw,
    icePowerKw: offer.icePowerKw,
    power30MinKw: motor30MinKnown ? offer.power30MinKw : undefined,
    power30MinKwByMotor: motor30MinKnown && Array.isArray(offer.power30MinKwByMotor) ? offer.power30MinKwByMotor : undefined,
    utilizationPowerKw: hasTrustedUtilizationPower(offer) ? offer.utilizationPowerKw : undefined,
    powertrainKind: offer.powertrainKind,
    productionDate: offer.productionDate,
    year: offer.year,
    fuel: offer.fuel,
    vehicleCategory: offer.vehicleCategory,
    tnVedCode: offer.tnVedCode,
    grossVehicleWeightKg: offer.grossVehicleWeightKg,
    bodyType: offer.bodyType,
    personalUseEligible: offer.personalUseEligible,
  });

  const configured: any = await getCalculationMarketVersion(offer.market);
  const market = resolveCatalogMarketConfig(offer.market, configured);
  const utilizationProblem = exactUtilizationPowerProblem(offer);
  const combinedMissing = [...new Set([
    ...(utilizationProblem?.missing || []),
    ...(Array.isArray(customs.missing) ? customs.missing : []),
  ])];

  if ((electrified || allowCombustionPreliminary) && onlyPowerDependentMissing(combinedMissing) && positive(customs.knownCustomsRub) > 0) {
    const calculation = calculateAvtocenaFromBusinessConfig({
      marketId: offer.market,
      marketConfig: market.config,
      sourcePriceRub: rate.sourcePriceRub,
      customsRub: customs.knownCustomsRub,
    });
    const excludedPriceItems = [
      ...(combinedMissing.some((item) => ["certified_30_minute_power_kw", "utilization_power_kw", "utilization_coefficient", "ice_power_kw"].includes(item)) ? ["utilization-fee"] : []),
      ...(combinedMissing.includes("electric_excise_power_kw") ? ["excise", "vat-excise-increment"] : []),
    ];
    const warning = "Предварительный расчёт: включены только подтверждённые на данный момент платежи. Утилизационный сбор и другие компоненты, зависящие от недостающей мощности, не включены; финальную сумму подтвердит менеджер.";
    return {
      ...offer,
      priceMode: offer.priceMode === "auction_start" ? "auction_start" : "estimated",
      totalRub: calculation.totalRub,
      calculationSnapshot: {
        ...calculation.snapshot,
        currencyRate: rate,
        eurRate,
        sourcePriceRub: rate.sourcePriceRub,
        customs,
        customsValue: customsValueSnapshot(rate, borderTransportRub, customsValueRub),
        customsCompleteness: "needs_data",
        marketConfigStatus: configured?.status || "missing",
        pricingConfidence: "preliminary",
        preliminary: true,
        preliminaryKnownCustomsRub: customs.knownCustomsRub,
        priceIncludesUtilizationFee: false,
        priceIncludesAllCustoms: false,
        excludedPriceItems,
        missing: combinedMissing,
        estimatedMarketFields: market.estimatedFields,
        powerConfidence: offer.powerDataConfidence,
        powerSource: offer.powerDataSource,
        certified30MinutePowerMissing: combinedMissing.includes("certified_30_minute_power_kw"),
        vehicleKnowledge: (offer.operational?.raw as any)?.vehicleKnowledgeModel || null,
        warnings: [...market.warnings, ...customs.warnings, ...(utilizationProblem ? [utilizationProblem.warning] : []), warning],
      },
      calculationStatus: "preliminary_power_pending",
    };
  }

  if (customs.status !== "ready" || customs.totalCustomsRub === undefined) {
    return {
      ...offer,
      totalRub: null,
      calculationSnapshot: {
        ...pendingSnapshot,
        eurRate,
        customs,
        customsValue: customsValueSnapshot(rate, borderTransportRub, customsValueRub),
        customsCompleteness: customs.status,
        marketConfigStatus: configured?.status || "missing",
        pricingConfidence: "unavailable",
        estimatedMarketFields: market.estimatedFields,
        certified30MinutePowerMissing: customs.missing.includes("certified_30_minute_power_kw"),
        missing: combinedMissing,
        warnings: [...market.warnings, ...customs.warnings, ...(utilizationProblem ? [utilizationProblem.warning] : [])],
      },
      calculationStatus: utilizationProblem ? "needs_utilization_power" : "needs_customs_data",
    };
  }

  const calculation = calculateAvtocenaFromBusinessConfig({
    marketId: offer.market,
    marketConfig: market.config,
    sourcePriceRub: rate.sourcePriceRub,
    customsRub: customs.totalCustomsRub,
  });

  const powerEstimated = ["reference", "estimated"].includes(String(offer.powerDataConfidence || ""));
  const customsAssumed = customs.personalUseAssumed || customs.vehicleCategoryAssumed;
  const priceEstimated = market.estimated || powerEstimated || customs.ageEstimated || customsAssumed || offer.priceMode === "estimated";
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
      eurRate,
      sourcePriceRub: rate.sourcePriceRub,
      customs,
      customsValue: customsValueSnapshot(rate, borderTransportRub, customsValueRub),
      customsCompleteness: customs.status,
      pricingConfidence: priceEstimated ? "estimated" : "exact",
      estimatedMarketFields: market.estimatedFields,
      powerConfidence: offer.powerDataConfidence,
      powerSource: offer.powerDataSource,
      certified30MinutePowerMissing: false,
      priceIncludesUtilizationFee: true,
      priceIncludesAllCustoms: true,
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

export async function calculateOfferWithRussiaCustoms(input: VehicleOffer): Promise<VehicleOffer> {
  return calculateOfferWithRussiaCustomsInternal(input, false);
}

// Recovery imports may publish a clearly marked lower bound when an exact sold
// lot has every source-bound field needed for customs except documented power.
// Regular imports keep the stricter default above and remain unpublished.
export async function calculateOfferWithPreliminaryPowerPricing(input: VehicleOffer): Promise<VehicleOffer> {
  return calculateOfferWithRussiaCustomsInternal(input, true);
}
