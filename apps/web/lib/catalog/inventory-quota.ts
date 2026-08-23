import type { VehicleOffer } from "./types";

export const CATALOG_MAX_OFFERS_PER_MODEL_YEAR = 20;

function clean(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim().toLocaleLowerCase("en-US");
}

/**
 * Public inventory diversity key per market + canonical make + exact model +
 * model year. The key is also used for diagnostics/showcase coverage.
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
 * Enforce the public model-year cap without changing the caller's quality
 * order. Japan is intentionally uncapped at publication: its month-long stock
 * is meant to accumulate every real listing/result we can validate. Diversity
 * for Japan is handled by showcase/search ordering rather than deleting real
 * cars from the public dataset.
 */
export function enforceCatalogModelYearQuota<T extends Partial<VehicleOffer>>(
  rows: readonly T[],
  options: { protectedIds?: ReadonlySet<string> } = {},
) {
  const counts = new Map<string, number>();
  const kept: T[] = [];
  const removed: T[] = [];
  for (const row of rows) {
    const market = clean(row?.market);
    if (market === "japan") {
      kept.push(row);
      continue;
    }
    const key = catalogModelYearQuotaKey(row);
    const count = key ? Number(counts.get(key) || 0) : 0;
    const protectedRow = options.protectedIds?.has(String(row?.id || "")) === true;
    if (protectedRow) {
      if (key) counts.set(key, count + 1);
      kept.push(row);
      continue;
    }
    if (!key || count >= CATALOG_MAX_OFFERS_PER_MODEL_YEAR) {
      removed.push(row);
      continue;
    }
    counts.set(key, count + 1);
    kept.push(row);
  }
  return { rows: kept, removed };
}

/**
 * Keep a small public showcase representative: prefer a new make first, then
 * a new exact model, and only use duplicate models when the market has no
 * other renderable candidates. Input order remains the freshness ranking.
 */
export function selectCatalogShowcaseDiversity<T extends { market?: unknown; make?: unknown; model?: unknown }>(
  rows: readonly T[],
  limit: number,
) {
  const boundedLimit = Math.max(0, Math.floor(Number(limit) || 0));
  if (!boundedLimit || !rows.length) return [] as T[];

  const selected: T[] = [];
  const selectedRows = new Set<T>();
  const makes = new Set<string>();
  const models = new Set<string>();
  const append = (row: T) => {
    selected.push(row);
    selectedRows.add(row);
    makes.add(clean(row.make));
    const modelKey = catalogExactModelKey(row as Partial<VehicleOffer>);
    if (modelKey) models.add(modelKey);
  };

  for (const row of rows) {
    const make = clean(row.make);
    const modelKey = catalogExactModelKey(row as Partial<VehicleOffer>);
    if (!make || !modelKey || makes.has(make) || models.has(modelKey)) continue;
    append(row);
    if (selected.length >= boundedLimit) return selected;
  }
  for (const row of rows) {
    const modelKey = catalogExactModelKey(row as Partial<VehicleOffer>);
    if (!modelKey || selectedRows.has(row) || models.has(modelKey)) continue;
    append(row);
    if (selected.length >= boundedLimit) return selected;
  }
  for (const row of rows) {
    if (selectedRows.has(row)) continue;
    append(row);
    if (selected.length >= boundedLimit) break;
  }
  return selected;
}

/**
 * Select a bounded collector result without letting a dense/new model-year
 * bucket consume the output before other discovered years get represented.
 * This helper is still useful for bounded source collection; the public Japan
 * dataset itself is not capped by model-year.
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
