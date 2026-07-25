import { getActiveMarketVersion } from "../business-settings";
import { calculateAvtocenaFromBusinessConfig } from "../../../../packages/engine/src/calculation/calculateAvtocena";
import { calculateRussiaCustomsForIndividual } from "../../../../packages/engine/src/calculation/russiaCustoms";
import { resolveCatalogMarketConfig } from "./estimated-market-config";
import { enrichOfferWithPowerKnowledge } from "./power-knowledge";
import { enrichOfferWithCertifiedPower } from "./power-reference";
import { convertToRub } from "./rates";
import { normalizeVehicleOfferSpecs } from "./spec-normalization";
import type { VehicleOffer } from "./types";
import { enrichOfferWithVehicleKnowledge } from "./vehicle-knowledge";

function positive(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function roundedPower(value: number) {
  return Math.round(value * 100) / 100;
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

function withConservativeUtilizationPreview(input: VehicleOffer) {
  const kind = String(input.powertrainKind || "");
  const electricOrHybrid = ["electric", "series_hybrid", "other_hybrid"].includes(kind);
  if (!electricOrHybrid || positive(input.utilizationPowerKw)) {
    return { offer: input, estimated: false, warning: "" };
  }

  const peakKw = positive(input.powerKw)
    || (positive(input.powerHp) ? roundedPower(positive(input.powerHp) * 0.73549875) : 0);
  const iceKw = positive(input.icePowerKw);
  const conservativeKw = kind === "other_hybrid"
    ? Math.max(peakKw, iceKw)
    : peakKw;
  if (!conservativeKw) return { offer: input, estimated: false, warning: "" };

  const warning = kind === "other_hybrid"
    ? "Для предварительной цены использована известная пиковая/системная мощность гибрида. Точный утильсбор будет пересчитан по мощности ДВС и максимальной 30-минутной мощности тяговых электромоторов из документов."
    : "Для предварительной цены консервативно использована пиковая мощность электромотора. Точный утильсбор будет пересчитан по максимальной 30-минутной мощности из ОТТС, СБКТС, ЗОЕТС, ЭПТС, CoC или документа производителя.";

  return {
    estimated: true,
    warning,
    offer: {
      ...input,
      utilizationPowerKw: roundedPower(conservativeKw),
      powerDataConfidence: "estimated" as const,
      powerDataSource: input.powerDataSource
        ? `${input.powerDataSource};estimated-utilization-preview`
        : "estimated-utilization-preview",
    },
  };
}

export async function calculateOfferWithRussiaCustoms(input: VehicleOffer): Promise<VehicleOffer> {
  const canonical = await enrichOfferWithVehicleKnowledge(input);
  const certified = await enrichOfferWithCertifiedPower(canonical);
  const known = await enrichOfferWithPowerKnowledge(certified);
  const normalized = normalizeVehicleOfferSpecs(known) as VehicleOffer;
  const preview = withConservativeUtilizationPreview(normalized);
  const offer = preview.offer;

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
    power30MinKw: offer.power30MinKw,
    power30MinKwByMotor: offer.power30MinKwByMotor,
    utilizationPowerKw: offer.utilizationPowerKw,
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
        warnings: [...market.warnings, ...customs.warnings, ...(preview.warning ? [preview.warning] : [])],
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

  const powerEstimated = preview.estimated || ["reference", "estimated"].includes(String(offer.powerDataConfidence || ""));
  const priceEstimated = market.estimated || powerEstimated || customs.ageEstimated || offer.priceMode === "estimated";
  const warnings = [
    ...market.warnings,
    ...customs.warnings,
    ...(preview.warning ? [preview.warning] : []),
    ...(!preview.estimated && powerEstimated ? ["Мощность подставлена по базе модели/модификации и должна быть подтверждена менеджером по конкретному автомобилю."] : []),
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
      certified30MinutePowerMissing: preview.estimated,
      utilizationPowerPreviewKw: preview.estimated ? offer.utilizationPowerKw : undefined,
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
