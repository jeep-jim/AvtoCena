import { expandCustomsBreakdown } from "./customs-breakdown";
import { confirmedProductionValue } from "./production-month";
import { synchronizeCombustionPower } from "./combustion-power-consistency";
import { getEffectiveMarketVersion } from "../effective-market-settings";
import { japanAuctionSoldPriceVerified } from "./public-priority";
import { calculateAvtocenaFromBusinessConfig } from "../../../../packages/engine/src/calculation/calculateAvtocena";
import { calculateRussiaCustomsForIndividual, normalizedCategory } from "../../../../packages/engine/src/calculation/russiaCustomsV2";
import { resolveCatalogMarketConfig } from "./estimated-market-config";
import { enrichOfferWithExplicitEngineDisplacement } from "./explicit-engine-displacement";
import { enrichOfferWithPowerKnowledge } from "./power-knowledge";
import { enrichOfferWithCertifiedPower } from "./power-reference";
import { preferExplicitCombustionPowertrain } from "./powertrain-safety";
import { convertToRub } from "./rates";
import { normalizeVehicleOfferSpecs } from "./spec-normalization";
import type { VehicleOffer } from "./types";
import { enrichOfferWithKnowledgeCore } from "./knowledge-core";
import { applyCatalogPowerScenario, readCatalogPowerScenario, resolveCatalogPowerScenario } from "./power-scenario";
import { isCalculableModificationOption, withoutDeliveredPrice, type CatalogModificationOption } from "./modification-contract";
import { specificationEvidenceComplete } from "./modification-matching";

function positive(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/**
 * Preserve the source-bound vehicle identity for risk-sensitive customs
 * classification. Knowledge enrichment may intentionally canonicalize a
 * marketplace model (for example `Rexton Sports Khan` -> `Rexton`), but that
 * must never erase evidence that the original vehicle is a pickup/commercial
 * derivative before the M1/N1 gate runs.
 */
export function customsVehicleIdentityEvidence(input: Partial<VehicleOffer>, normalized: Partial<VehicleOffer>) {
  return [
    normalized.sourceTitle,
    input.sourceTitle,
    input.make,
    input.model,
    input.bodyType,
  ]
    .map((value) => String(value || "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" · ");
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

const getCalculationMarketVersion = getEffectiveMarketVersion;

function transportToBorderRub(offer: VehicleOffer) {
  const raw: any = offer.operational?.raw || {};
  return positive(raw.transportToBorderRub)
    || positive(raw.deliveryToBorderRub)
    || positive(raw.freightToBorderRub)
    || positive(raw.customsTransportRub);
}

function customsValueSnapshot(rate: any, borderTransportRub: number, customsValueRub: number, commercial = false) {
  return {
    vehiclePriceRub: rate.sourcePriceRub,
    transportToBorderRub: borderTransportRub,
    transportExcludedFromCustomsValueRub: commercial ? 0 : borderTransportRub,
    transportIncludedInCustomsValue: commercial,
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

async function calculateOfferWithRussiaCustomsInternal(input: VehicleOffer, allowCombustionPreliminary: boolean, requestedPowerHp?: number, resolvedModification = false, userParameters = false): Promise<VehicleOffer> {
  const coreEnriched = resolvedModification ? input : await enrichOfferWithKnowledgeCore(enrichOfferWithExplicitEngineDisplacement(input));
  const representativePowerHp = String(coreEnriched.powerDataSource || "").startsWith("vehicle-model-representative:")
    ? positive(coreEnriched.powerHp)
    : 0;
  const canonical = discardRepresentativeModelPowerForCustoms(coreEnriched);
  const certified = resolvedModification ? canonical : await enrichOfferWithCertifiedPower(canonical);
  const known = resolvedModification ? certified : await enrichOfferWithPowerKnowledge(certified);
  const normalized = synchronizeCombustionPower(resolvedModification ? known : preferExplicitCombustionPowertrain(normalizeVehicleOfferSpecs(known) as VehicleOffer) as VehicleOffer);
  const electrified = isElectrifiedKind(normalized.powertrainKind);
  const exactOffer = electrified && positive(normalized.utilizationPowerKw) && !hasTrustedUtilizationPower(normalized)
    ? { ...normalized, utilizationPowerKw: undefined } as VehicleOffer
    : normalized;
  const scenario = resolvedModification ? null : resolveCatalogPowerScenario(exactOffer, { requestedHp: requestedPowerHp, representativeHp: representativePowerHp || undefined });
  const offer = scenario ? applyCatalogPowerScenario(exactOffer, scenario) : exactOffer;
  const powerScenario = readCatalogPowerScenario(offer);

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
  if (!electrified && !positive(offer.powerHp) && !allowCombustionPreliminary && normalizedCategory(offer).category !== "N1") {
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

  const configured: any = await getCalculationMarketVersion(offer.market);
  const market = resolveCatalogMarketConfig(offer.market, configured);
  const commercial = normalizedCategory(offer).category === "N1";
  const enteredTransport = offer.transportToBorderRub;
  const hasEnteredTransport = enteredTransport != null && Number.isFinite(enteredTransport) && enteredTransport >= 0;
  const borderTransportRub = commercial
    ? hasEnteredTransport ? enteredTransport : transportToBorderRub(offer) || Number(market.config.logisticsRub || 0)
    : transportToBorderRub(offer);
  // Goods imports include pre-border transport. In an N1 customer scenario this
  // replaces the logistics line, so it is not added twice to the delivered total.
  const customsValueRub = rate.sourcePriceRub + (commercial ? borderTransportRub : 0);
  if (commercial) {
    market.config = {...market.config,logisticsRub:borderTransportRub};
    if (!hasEnteredTransport) {
      market.estimated = true;
      market.warnings.push("Доставка до границы для N1 принята из расходов рынка; уточните сумму в карточке.");
    }
  }
  const motor30MinKnown = documentedMotorPower(offer) > 0 || (userParameters && positive(offer.power30MinKw) > 0);
  const customsInput = {
    customsValueRub,
    importedAt: userParameters && offer.customsCalculationDate ? new Date(`${offer.customsCalculationDate}T00:00:00Z`) : undefined,
    eurRateRub: Number(eurRate.effectiveRate || 0),
    engineCc: offer.engineCc,
    powerHp: offer.powerHp,
    powerKw: offer.powerKw,
    icePowerKw: offer.icePowerKw,
    power30MinKw: motor30MinKnown ? offer.power30MinKw : undefined,
    power30MinKwByMotor: motor30MinKnown && Array.isArray(offer.power30MinKwByMotor) ? offer.power30MinKwByMotor : undefined,
    utilizationPowerKw: powerScenario && String(offer.powertrainKind || "") === "combustion"
      ? offer.utilizationPowerKw
      : hasTrustedUtilizationPower(offer)
        ? offer.utilizationPowerKw
        : undefined,
    powertrainKind: offer.powertrainKind,
    productionDate: userParameters ? offer.productionDate : confirmedProductionValue(offer) || undefined,
    year: offer.year,
    fuel: offer.fuel,
    vehicleCategory: offer.vehicleCategory,
    tnVedCode: offer.tnVedCode,
    grossVehicleWeightKg: offer.grossVehicleWeightKg,
    n1IceFuel: offer.n1IceFuel,
    bodyType: offer.bodyType,
    make: offer.make,
    model: offer.model,
    sourceTitle: customsVehicleIdentityEvidence(input, offer),
    personalUseEligible: offer.personalUseEligible,
  };
  const customs = calculateRussiaCustomsForIndividual(customsInput);

  const utilizationProblem = userParameters || commercial ? null : exactUtilizationPowerProblem(offer);
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
        customsInput,
        customsValue: customsValueSnapshot(rate, borderTransportRub, customsValueRub, commercial),
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
        customsInput,
        customsValue: customsValueSnapshot(rate, borderTransportRub, customsValueRub, commercial),
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
    customsRub: customs.knownCustomsRub,
    utilizationFeeRub: customs.utilizationFeeRub,
  });

  const powerEstimated = Boolean(powerScenario) || ["reference", "estimated"].includes(String(offer.powerDataConfidence || ""));
  const customsAssumed = customs.personalUseAssumed || customs.vehicleCategoryAssumed;
  const priceEstimated = market.estimated || powerEstimated || customs.ageEstimated || customsAssumed || offer.priceMode === "estimated";
  const warnings = [
    ...market.warnings,
    ...customs.warnings,
    ...(powerScenario ? [`Предварительный сценарий мощности: ${powerScenario.horsepower} л.с. Значение влияет на утильсбор и должно быть подтверждено по документам автомобиля.`] : powerEstimated ? ["Мощность подставлена по базе модели/модификации и должна быть подтверждена менеджером по конкретному автомобилю."] : []),
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
      customsInput,
      customsValue: customsValueSnapshot(rate, borderTransportRub, customsValueRub, commercial),
      customsCompleteness: customs.status,
      pricingConfidence: priceEstimated ? "estimated" : "exact",
      estimatedMarketFields: market.estimatedFields,
      powerConfidence: offer.powerDataConfidence,
      powerSource: offer.powerDataSource,
      certified30MinutePowerMissing: false,
      priceIncludesUtilizationFee: true,
      priceIncludesAllCustoms: true,
      vehicleKnowledge: (offer.operational?.raw as any)?.vehicleKnowledgeModel || null,
      powerScenario: powerScenario || undefined,
      powerRequiresConfirmation: Boolean(powerScenario),
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

export async function calculateOfferWithUserPowerScenario(input: VehicleOffer, horsepower: number): Promise<VehicleOffer> {
  return calculateOfferWithRussiaCustomsInternal(input, false, horsepower);
}

/** Called only after the server resolves an allowed variant ID for this listing. */
export async function calculateOfferWithResolvedModification(input: VehicleOffer, option: CatalogModificationOption): Promise<VehicleOffer> {
  if (input.market === "japan" || !isCalculableModificationOption(option)) throw new Error("invalid_modification_option");
  const clean = withoutDeliveredPrice(input);
  const conditional: VehicleOffer = {
    ...clean, engineCc: option.engineCc, engineType: undefined,
    fuel: option.fuel, powertrainKind: option.powertrainKind,
    powerHp: option.powerHp, powerKw: option.powerKw, icePowerKw: option.icePowerKw,
    power30MinKw: option.power30MinKw, power30MinKwByMotor: undefined, utilizationPowerKw: undefined,
    transmission: option.transmission, drive: option.drive,
    powerDataConfidence: "documented", powerDataSource: `conditional_modification:${option.id}`,
    calculationSnapshot: { modificationScenario: { version: 1, source: "customer_selection", variantId: option.id,
      evidenceIds: option.evidenceIds, requiresConfirmation: true } },
  };
  const result = requireFreshRecoveryRates(await calculateOfferWithRussiaCustomsInternal(conditional, false, undefined, true));
  return { ...result, calculationSnapshot: { ...result.calculationSnapshot,
    modificationScenario: conditional.calculationSnapshot.modificationScenario } };
}

export async function calculateOfferWithVerifiedSpecifications(input: VehicleOffer, includeVerifiedJapanAuction = false): Promise<VehicleOffer> {
  if ((input.market === "japan" && (!includeVerifiedJapanAuction || !japanAuctionSoldPriceVerified(input))) || !specificationEvidenceComplete(input)) throw new Error("verified_specifications_required");
  return requireFreshRecoveryRates(await calculateOfferWithRussiaCustomsInternal(withoutDeliveredPrice(input), false, undefined, true));
}

export function requireFreshRecoveryRates(offer: VehicleOffer, now = Date.now()): VehicleOffer {
  const snapshot = offer.calculationSnapshot || {};
  const rates = [snapshot.currencyRate, snapshot.eurRate];
  const fresh = rates.every(rate => {
    const date = Date.parse(String(rate?.rateDate || ""));
    return isOfficialCustomsCurrencyRate(rate) && Number.isFinite(date)
      && now - date <= 4 * 86400000 && date - now <= 86400000;
  });
  if (fresh || !(Number(offer.totalRub) > 0)) return offer;
  return { ...withoutDeliveredPrice(offer), calculationStatus: "needs_currency_rate",
    calculationSnapshot: { ...snapshot, breakdown: [], pricingConfidence: "unavailable", missing: ["fresh_official_currency_rates"] } };
}

// Recovery imports may publish a clearly marked lower bound when an exact sold
// lot has every source-bound field needed for customs except documented power.
// Regular imports keep the stricter default above and remain unpublished.
export async function calculateOfferWithPreliminaryPowerPricing(input: VehicleOffer): Promise<VehicleOffer> {
  return calculateOfferWithRussiaCustomsInternal(input, true);
}

/** Ephemeral scenario: validated customer inputs never become catalog evidence. */
export async function calculateCustomerParameterScenario(input: VehicleOffer, parameters: Partial<VehicleOffer>) {
  const scenario: VehicleOffer = { ...withoutDeliveredPrice(input), ...parameters,
    catalogPricingMode: undefined, sellerPriceRub: undefined, modificationSelection: undefined, recoveryQualification: undefined,
    powerDataConfidence: "estimated", powerDataSource: "customer_input",
    utilizationPowerKw: undefined, power30MinKwByMotor: undefined, productionDate: parameters.productionDate,
    calculationSnapshot: {}, operational: { ...input.operational, raw: undefined } };
  return requireFreshRecoveryRates(await calculateOfferWithRussiaCustomsInternal(scenario, false, undefined, true, true));
}

export async function calculateOfferWithCustomerParametersDetailed(input: VehicleOffer, parameters: Partial<VehicleOffer>) {
  const result = await calculateCustomerParameterScenario(input, parameters);
  if (result.calculationSnapshot?.customs?.status !== "ready" || result.calculationSnapshot?.priceIncludesAllCustoms !== true) {
    const snapshot = result.calculationSnapshot;
    const missing = [...new Set<string>([...(snapshot?.missing || []), ...(snapshot?.customs?.missing || [])])];
    return { ok: false as const, error: customerCalculationFailureMessage(missing), missing };
  }
  return {ok: true as const, calculation: {totalRub:result.totalRub,breakdown:expandCustomsBreakdown(result.calculationSnapshot?.breakdown || [],result.calculationSnapshot?.customs),rateDate:result.calculationSnapshot?.currencyRate?.rateDate,customs:result.calculationSnapshot?.customs,warnings:result.calculationSnapshot?.warnings}};
}

/** Preserve the nullable contract used by existing integrations. */
export async function calculateOfferWithCustomerParameters(input: VehicleOffer, parameters: Partial<VehicleOffer>) {
  const result = await calculateOfferWithCustomerParametersDetailed(input, parameters);
  return result.ok ? result.calculation : null;
}

export function customerCalculationFailureMessage(missing: string[]): string {
  if (missing.includes("vehicle_category")) return "Выберите категорию в блоке «Категория и масса»: M1 — легковой или N1 — грузовой. Для N1 укажите полную разрешённую массу по документам — расчёт появится здесь.";
  if (missing.includes("n1_customs_tariff")) return "Параметры приняты. Для категории N1 нужен отдельный расчёт пошлины и утильсбора. Автоматический расчёт этой категории пока не поддерживается. Обратитесь к менеджеру за расчётом.";
  const labels: Record<string, string> = {
    source_currency_rate: "курс валюты исходной цены", official_source_currency_rate: "официальный курс валюты исходной цены",
    official_eur_rate: "официальный курс евро", eur_rate: "курс евро", fresh_official_currency_rates: "актуальные официальные курсы валют",
    customs_value: "стоимость для таможенного расчёта", production_date: "дата выпуска", engine_cc: "объём двигателя",
    power_hp: "мощность двигателя", powertrain_kind: "тип силовой установки",
    certified_30_minute_power_kw: "подтверждённая 30-минутная мощность", electric_excise_power_kw: "мощность электродвигателя для расчёта акциза",
    gross_vehicle_weight_kg: "полная разрешённая масса N1 до 3500 кг", n1_ice_fuel: "топливо ДВС гибрида", n1_hybrid_power: "мощность ДВС и 30-минутная мощность электромоторов", tn_ved_conflict: "согласованные код ТН ВЭД и характеристики", tariff_year: "ставки на выбранный год ввоза", n1_tariff_year: "ставки N1 на выбранный год ввоза", fuel: "топливо двигателя",
    utilization_coefficient: "коэффициент утильсбора"
  };
  const reasons = [...new Set(missing.map(key => labels[key]).filter(Boolean))];
  return reasons.length ? `Для полного расчёта нужны: ${reasons.join("; ")}. Уточните доступные параметры в карточке. После заполнения расчёт обновится автоматически.`
    : "Параметры приняты, но полный расчёт пока недоступен. Обратитесь к менеджеру для проверки исходной цены и условий ввоза.";
}
