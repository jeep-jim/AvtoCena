import type { EncyclopediaIdentityResolver } from "./encyclopedia-identity";

export type CatalogIdentityMetadata = {
  version: 2;
  rawMake: string;
  rawModel: string;
  canonicalBrandId: string | null;
  canonicalModelId: string | null;
  makeSource: string;
  modelSource: string;
  fullyResolved: boolean;
  ambiguous: boolean;
};

type IdentityCarrier = {
  make: string;
  model: string;
  operational?: Record<string, unknown>;
};

export type IdentityApplied<T extends IdentityCarrier> = Omit<T, "make" | "model" | "operational"> & {
  make: string;
  model: string;
  operational: Record<string, unknown> & { encyclopediaIdentity: CatalogIdentityMetadata };
};

/**
 * Pure application step for a previously validated Encyclopedia V2 resolver.
 *
 * This function intentionally does not perform fuzzy matching and does not
 * decide whether V2 is enabled. The caller owns the feature gate. It always
 * keeps source spelling and resolution status in operational metadata, so an
 * unresolved offer remains ingestible and can later be re-projected without
 * re-downloading it from the market.
 */
export function applyEncyclopediaIdentity<T extends IdentityCarrier>(resolver: EncyclopediaIdentityResolver, input: T): IdentityApplied<T> {
  const result = resolver.resolve({ make: input.make, model: input.model });
  const identity: CatalogIdentityMetadata = {
    version: 2,
    rawMake: result.rawMake,
    rawModel: result.rawModel,
    canonicalBrandId: result.brandId,
    canonicalModelId: result.modelId,
    makeSource: result.makeSource,
    modelSource: result.modelSource,
    fullyResolved: result.resolved,
    ambiguous: result.ambiguous,
  };

  return {
    ...input,
    make: result.brandId ? result.canonicalMake : input.make,
    model: result.modelId ? result.canonicalModel : input.model,
    operational: {
      ...(input.operational || {}),
      encyclopediaIdentity: identity,
    },
  };
}
