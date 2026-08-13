import type { VehicleOffer } from "./types";

export const CATALOG_MAX_OFFERS_PER_MODEL_YEAR = 20;

function clean(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim().toLocaleLowerCase("en-US");
}

/**
 * Public inventory diversity is bounded per market + canonical make + exact
 * model + model year. Different years of the same model must never compete for
 * the same 20-card bucket.
 */
export function catalogModelYearQuotaKey(
  offer: Pick<VehicleOffer, "market" | "make" | "model" | "year"> | Partial<VehicleOffer>,
  marketOverride?: unknown,
) {
  const market = clean(marketOverride || offer?.market);
  const make = clean(offer?.make);
  const model = clean(offer?.model);
  const year = Number(offer?.year || 0);
  if (!market || !make || !model || !Number.isInteger(year) || year <= 0) return "";
  return `${market}|${make}|${model}|${year}`;
}

export function catalogExactModelKey(
  offer: Pick<VehicleOffer, "market" | "make" | "model"> | Partial<VehicleOffer>,
  marketOverride?: unknown,
) {
  const market = clean(marketOverride || offer?.market);
  const make = clean(offer?.make);
  const model = clean(offer?.model);
  return market && make && model ? `${market}|${make}|${model}` : "";
}
