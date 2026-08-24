import type { VehicleOffer } from "./types";

export const CATALOG_MAX_OFFERS_PER_MODEL_YEAR = 20;
export const CATALOG_SHOWCASE_MAX_POWER_HP = 160;
export const CATALOG_SHOWCASE_LOW_POWER_MIN_SHARE = 0.8;

function clean(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim().toLocaleLowerCase("en-US");
}

function positivePowerHp(value: unknown) {
  const power = Number(value);
  return Number.isFinite(power) && power > 0 && power <= 2_500 ? power : 0;
}

function isShowcaseLowPower(row: { powerHp?: unknown }) {
  const power = positivePowerHp(row.powerHp);
  return power > 0 && power <= CATALOG_SHOWCASE_MAX_POWER_HP;
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
 * Enforce the public model-year cap without changing the caller's quality
 * order. This is intentionally part of the canonical publication path: brand
 * normalization can merge formerly separate source buckets, so the final
 * public identity must be capped after identity normalization and deduplication.
 */
export function enforceCatalogModelYearQuota<T extends Partial<VehicleOffer>>(
  rows: readonly T[],
  options: { protectedIds?: ReadonlySet<string> } = {},
) {
  const counts = new Map<string, number>();
  const kept: T[] = [];
  const removed: T[] = [];
  for (const row of rows) {
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
 * Keep a small public showcase representative while enforcing the commercial
 * priority the product promises: when enough <=160 hp cars exist, at least 80%
 * of the showcase comes from that group. Higher-power cars are NOT discarded;
 * they remain available and fill the remaining showcase slots after the target
 * share is satisfied. Inside each pool we still prefer a new make first, then a
 * new exact model, and finally duplicate models, preserving the caller's order.
 */
export function selectCatalogShowcaseDiversity<T extends { market?: unknown; make?: unknown; model?: unknown; powerHp?: unknown }>(
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
    if (selectedRows.has(row)) return;
    selected.push(row);
    selectedRows.add(row);
    makes.add(clean(row.make));
    const modelKey = catalogExactModelKey(row as Partial<VehicleOffer>);
    if (modelKey) models.add(modelKey);
  };
  const fillDiverse = (pool: readonly T[], target: number) => {
    if (selected.length >= target) return;
    for (const row of pool) {
      const make = clean(row.make);
      const modelKey = catalogExactModelKey(row as Partial<VehicleOffer>);
      if (!make || !modelKey || selectedRows.has(row) || makes.has(make) || models.has(modelKey)) continue;
      append(row);
      if (selected.length >= target) return;
    }
    for (const row of pool) {
      const modelKey = catalogExactModelKey(row as Partial<VehicleOffer>);
      if (!modelKey || selectedRows.has(row) || models.has(modelKey)) continue;
      append(row);
      if (selected.length >= target) return;
    }
    for (const row of pool) {
      if (selectedRows.has(row)) continue;
      append(row);
      if (selected.length >= target) return;
    }
  };

  const lowPowerRows = rows.filter(isShowcaseLowPower);
  const requestedLowPower = Math.ceil(boundedLimit * CATALOG_SHOWCASE_LOW_POWER_MIN_SHARE);
  const lowPowerTarget = Math.min(requestedLowPower, lowPowerRows.length);
  fillDiverse(lowPowerRows, lowPowerTarget);
  fillDiverse(rows, boundedLimit);
  return selected;
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
