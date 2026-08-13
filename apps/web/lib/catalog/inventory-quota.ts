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

/**
 * Select a bounded result without letting a dense/new model-year bucket consume
 * the output before other discovered years get represented. Every discovered
 * model-year receives one turn before any bucket receives a second turn, then
 * the process repeats. Rows inside one bucket can still be ranked by source
 * quality via `compare`. A bucket can never exceed the shared 20-card quota.
 */
export function selectCatalogModelYearCoverageFirst<T extends Partial<VehicleOffer>>(
  rows: readonly T[],
  limit: number,
  compare: (a: T, b: T) => number = () => 0,
) {
  const boundedLimit = Math.max(0, Math.floor(Number(limit) || 0));
  if (!boundedLimit || !rows.length) return [] as T[];

  const buckets = new Map<string, T[]>();
  for (const row of rows) {
    const key = catalogModelYearQuotaKey(row);
    if (!key) continue;
    const bucket = buckets.get(key) || [];
    bucket.push(row);
    buckets.set(key, bucket);
  }

  const orderedBuckets = [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b, "en"))
    .map(([, bucket]) => [...bucket].sort(compare).slice(0, CATALOG_MAX_OFFERS_PER_MODEL_YEAR));
  const selected: T[] = [];
  for (let round = 0; selected.length < boundedLimit; round++) {
    let added = false;
    for (const bucket of orderedBuckets) {
      const row = bucket[round];
      if (!row) continue;
      selected.push(row);
      added = true;
      if (selected.length >= boundedLimit) break;
    }
    if (!added) break;
  }
  return selected;
}
