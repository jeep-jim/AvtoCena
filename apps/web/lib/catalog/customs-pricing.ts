import { getActiveMarketVersion } from "../business-settings";
import { calculateAvtocenaFromBusinessConfig } from "../../../../packages/engine/src/calculation/calculateAvtocena";
import { calculateRussiaCustomsForIndividual } from "../../../../packages/engine/src/calculation/russiaCustoms";
import { convertToRub } from "./rates";
import { normalizeVehicleOfferSpecs } from "./spec-normalization";
import type { VehicleOffer } from "./types";

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

export async function calculateOfferWithRussiaCustoms(input: VehicleOffer): Promise<VehicleOffer> {
  const offer = normalizeVehicleOfferSpecs(input) as VehicleOffer;
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

  const version: any = await getActiveMarketVersion(offer.market);
  if (!version) {
    return {
      ...offer,
      totalRub: null,
      calculationSnapshot: {
        currencyRate: rate,
        customs,
        customsValue: {
          vehiclePriceRub: rate.sourcePriceRub,
          transportToBorderRub: borderTransportRub,
          totalRub: customsValueRub,
        },
        customsCompleteness: customs.status,
      },
      calculationStatus: "needs_market_config",
    };
  }

  if (customs.status !== "ready" || customs.totalCustomsRub === undefined) {
    return {
      ...offer,
      totalRub: null,
      calculationSnapshot: {
        currencyRate: rate,
        customs,
        customsValue: {
          vehiclePriceRub: rate.sourcePriceRub,
          transportToBorderRub: borderTransportRub,
          totalRub: customsValueRub,
        },
        customsCompleteness: customs.status,
      },
      calculationStatus: "needs_customs_data",
    };
  }

  const calculation = calculateAvtocenaFromBusinessConfig({
    marketId: offer.market,
    marketConfig: version,
    sourcePriceRub: rate.sourcePriceRub,
    customsRub: customs.totalCustomsRub,
  });

  return {
    ...offer,
    totalRub: calculation.totalRub,
    calculationSnapshot: {
      ...calculation.snapshot,
      currencyRate: rate,
      customs,
      customsValue: {
        vehiclePriceRub: rate.sourcePriceRub,
        transportToBorderRub: borderTransportRub,
        totalRub: customsValueRub,
      },
      customsCompleteness: customs.status,
    },
    calculationStatus: offer.priceMode === "auction_start" ? "auction_start" : "ready",
  };
}
