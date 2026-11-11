import type { EncyclopediaIdentityResolver } from "./encyclopedia-identity";
import { applyEncyclopediaIdentity, type IdentityApplied } from "./encyclopedia-identity-application";

type IdentityRow = {
  id: string;
  make: string;
  model: string;
  market?: string;
  sourceId?: string;
  operational?: Record<string, unknown>;
  [key: string]: unknown;
};

export type EncyclopediaIdentityReprojectionReport = {
  total: number;
  changed: number;
  brandChanged: number;
  modelChanged: number;
  fullyResolved: number;
  unresolvedBrands: number;
  unresolvedModels: number;
  ambiguous: number;
  beforeBrands: number;
  afterBrands: number;
  beforeMakeModels: number;
  afterMakeModels: number;
};

function clean(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function identityFreeSnapshot(row: object) {
  const value = row as Record<string, unknown>;
  const { make: _make, model: _model, operational, ...rest } = value;
  const operationalValue = operational && typeof operational === "object" && !Array.isArray(operational)
    ? operational as Record<string, unknown>
    : {};
  const { encyclopediaIdentity: _identity, ...operationalRest } = operationalValue;
  return JSON.stringify({ ...rest, operational: operationalRest });
}

/**
 * Dry-run canonical reprojection. It never writes storage and fails if the
 * identity application mutates any field except public make/model and the
 * dedicated operational.encyclopediaIdentity audit metadata. IDs, pricing,
 * images, source/raw payload, VIN/frame metadata and all other fields must stay
 * byte-for-byte equivalent at this boundary.
 */
export function planEncyclopediaIdentityReprojection<T extends IdentityRow>(
  resolver: EncyclopediaIdentityResolver,
  rows: T[],
): { rows: Array<T | IdentityApplied<T>>; report: EncyclopediaIdentityReprojectionReport } {
  const ids = new Set<string>();
  const beforeBrands = new Set<string>();
  const afterBrands = new Set<string>();
  const beforePairs = new Set<string>();
  const afterPairs = new Set<string>();
  let changed = 0;
  let brandChanged = 0;
  let modelChanged = 0;
  let fullyResolved = 0;
  let unresolvedBrands = 0;
  let unresolvedModels = 0;
  let ambiguous = 0;

  const projected = rows.map((row) => {
    if (!row?.id) throw new Error("encyclopedia_reprojection_offer_id_missing");
    if (ids.has(row.id)) throw new Error(`encyclopedia_reprojection_offer_id_duplicate:${row.id}`);
    ids.add(row.id);

    const beforeMake = clean(row.make);
    const beforeModel = clean(row.model);
    beforeBrands.add(beforeMake);
    beforePairs.add(`${beforeMake}\u0000${beforeModel}`);

    const resolution = resolver.resolve({ make: beforeMake, model: beforeModel });
    const next = applyEncyclopediaIdentity(resolver, row);
    if (next.id !== row.id) throw new Error(`encyclopedia_reprojection_offer_id_changed:${row.id}`);
    if (identityFreeSnapshot(next) !== identityFreeSnapshot(row)) {
      throw new Error(`encyclopedia_reprojection_non_identity_mutation:${row.id}`);
    }

    const afterMake = clean(next.make);
    const afterModel = clean(next.model);
    afterBrands.add(afterMake);
    afterPairs.add(`${afterMake}\u0000${afterModel}`);
    if (afterMake !== beforeMake || afterModel !== beforeModel) changed++;
    if (afterMake !== beforeMake) brandChanged++;
    if (afterModel !== beforeModel) modelChanged++;
    if (resolution.brandId && (!beforeModel || resolution.modelId)) fullyResolved++;
    if (!resolution.brandId) unresolvedBrands++;
    else if (beforeModel && !resolution.modelId) unresolvedModels++;
    if (resolution.ambiguous) ambiguous++;
    return next;
  });

  return {
    rows: projected,
    report: {
      total: rows.length,
      changed,
      brandChanged,
      modelChanged,
      fullyResolved,
      unresolvedBrands,
      unresolvedModels,
      ambiguous,
      beforeBrands: beforeBrands.size,
      afterBrands: afterBrands.size,
      beforeMakeModels: beforePairs.size,
      afterMakeModels: afterPairs.size,
    },
  };
}
