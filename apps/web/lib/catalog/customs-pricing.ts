import { getActiveMarketVersion } from "../business-settings";
import { calculateAvtocenaFromBusinessConfig } from "../../../../packages/engine/src/calculation/calculateAvtocena";
import { calculateRussiaCustomsForIndividual } from "../../../../packages/engine/src/calculation/russiaCustoms";
import { convertToRub } from "./rates";
import { normalizeVehicleOfferSpecs } from "./spec-normalization";
import type { VehicleOffer } from "./types";

export async function calculateOfferWithRussiaCustoms(input: VehicleOffer): Promise<VehicleOffer> {
  const offer = normalizeVehicleOfferSpecs(input) as VehicleOffer;
  const [rate, eurRate] = await Promise.all([
    convertToRub(offer.sourcePrice, offer.sourceCurrency),
    convertToRub(1, "EUR"),
  ]);
  if (!rate) return offer;

  const version: any = await getActiveMarketVersion(offer.market);
  if (!version) {
    return {
      ...offer,
      totalRub: rate.sourcePriceRub,
      calculationSnapshot: { currencyRate: rate, customs: { status: "needs_data", missing: ["market_config"] } },
      calculationStatus: "needs_market_config",
    };
  }

  const customs = calculateRussiaCustomsForIndividual({
    customsValueRub: rate.sourcePriceRub,
    eurRateRub: Number(eurRate?.effectiveRate || 0),
    engineCc: offer.engineCc,
    powerHp: offer.powerHp,
    powerKw: offer.powerKw,
    productionDate: offer.productionDate,
    year: offer.year,
    fuel: offer.fuel,
  });

  const specialPowertrain = /electric|hybrid|phev|hev|mhev|reev|электро|гибрид/i.test(String(offer.fuel || ""));
  const customsRub = customs.status === "ready" ? customs.totalCustomsRub : customs.knownCustomsRub;
  const calculation = calculateAvtocenaFromBusinessConfig({
    marketId: offer.market,
    marketConfig: version,
    sourcePriceRub: rate.sourcePriceRub,
    customsRub,
  });

  const incompleteCombustionCustoms = customs.status !== "ready" && !specialPowertrain;
  return {
    ...offer,
    totalRub: incompleteCombustionCustoms ? null : calculation.totalRub,
    calculationSnapshot: {
      ...calculation.snapshot,
      currencyRate: rate,
      customs,
      customsCompleteness: customs.status,
    },
    calculationStatus: incompleteCombustionCustoms
      ? "needs_customs_data"
      : customs.status === "ready"
        ? (offer.priceMode === "auction_start" ? "auction_start" : "ready")
        : "customs_estimate_incomplete",
  };
}
