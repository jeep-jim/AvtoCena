import type { EncyclopediaIdentityResolver } from "./encyclopedia-identity";

type QueueOffer = {
  make: string;
  model: string;
  market?: string;
  sourceId?: string;
};

export type EncyclopediaIdentityReviewItem = {
  scope: "brand" | "model";
  status: "unresolved" | "ambiguous";
  rawMake: string;
  rawModel?: string;
  canonicalBrandId?: string;
  canonicalMake?: string;
  count: number;
  markets: Array<{ value: string; count: number }>;
  sources: Array<{ value: string; count: number }>;
  sampleModels?: Array<{ value: string; count: number }>;
};

function clean(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function addCount(map: Map<string, number>, value: unknown) {
  const key = clean(value) || "unknown";
  map.set(key, Number(map.get(key) || 0) + 1);
}

function counts(map: Map<string, number>, limit = 20) {
  return [...map.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((left, right) => right.count - left.count || left.value.localeCompare(right.value, "ru"))
    .slice(0, limit);
}

type MutableItem = EncyclopediaIdentityReviewItem & {
  marketCounts: Map<string, number>;
  sourceCounts: Map<string, number>;
  modelCounts: Map<string, number>;
};

/**
 * Builds a fail-closed research queue from real inventory. It never invents a
 * suggested identity: unresolved and ambiguous source spellings are merely
 * ranked by inventory impact so Encyclopedia research can address the highest
 * value gaps first.
 */
export function buildEncyclopediaIdentityReviewQueue(
  resolver: EncyclopediaIdentityResolver,
  offers: QueueOffer[],
  limit = 500,
) {
  const rows = new Map<string, MutableItem>();

  for (const offer of offers) {
    const rawMake = clean(offer.make);
    const rawModel = clean(offer.model);
    if (!rawMake) continue;
    const result = resolver.resolve({ make: rawMake, model: rawModel });
    if (result.brandId && (!rawModel || result.modelId)) continue;

    const scope: "brand" | "model" = result.brandId ? "model" : "brand";
    const status: "unresolved" | "ambiguous" = result.ambiguous ? "ambiguous" : "unresolved";
    const key = scope === "brand"
      ? `brand:${status}:${rawMake}`
      : `model:${status}:${result.brandId}:${rawModel}`;
    let row = rows.get(key);
    if (!row) {
      row = {
        scope,
        status,
        rawMake,
        ...(scope === "model" ? { rawModel } : {}),
        ...(result.brandId ? { canonicalBrandId: result.brandId, canonicalMake: result.canonicalMake } : {}),
        count: 0,
        markets: [],
        sources: [],
        ...(scope === "brand" ? { sampleModels: [] } : {}),
        marketCounts: new Map(),
        sourceCounts: new Map(),
        modelCounts: new Map(),
      };
      rows.set(key, row);
    }
    row.count++;
    addCount(row.marketCounts, offer.market);
    addCount(row.sourceCounts, offer.sourceId);
    if (scope === "brand" && rawModel) addCount(row.modelCounts, rawModel);
  }

  const items = [...rows.values()]
    .sort((left, right) => right.count - left.count
      || (left.status === right.status ? 0 : left.status === "ambiguous" ? -1 : 1)
      || `${left.rawMake} ${left.rawModel || ""}`.localeCompare(`${right.rawMake} ${right.rawModel || ""}`, "ru"))
    .slice(0, Math.max(1, limit))
    .map(({ marketCounts, sourceCounts, modelCounts, ...row }) => ({
      ...row,
      markets: counts(marketCounts),
      sources: counts(sourceCounts),
      ...(row.scope === "brand" ? { sampleModels: counts(modelCounts) } : {}),
    }));

  return {
    version: 1,
    totalOffers: offers.length,
    queued: items.reduce((sum, item) => sum + item.count, 0),
    uniqueItems: items.length,
    items,
  };
}
