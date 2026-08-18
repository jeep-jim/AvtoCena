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
};

type IdentityCarrier = {
  make: string;
  model: string;
  operational?: Record<string, unknown>;
};

/**
 * Pure application step for a previously validated Encyclopedia V2 resolver.
 *
 * This function intentionally does not perform fuzzy matching and does not
 * decide whether V2 is enabled. The caller owns the feature gate. It also
 * keeps the original source spelling in operational metadata so an offer can
 * always be audited/re-projected without re-downloading it from the market.
 */
export function applyEncyclopediaIdentity<T extends IdentityCarrier>(resolver: EncyclopediaIdentityResolver, input: T): T {
  const result = resolver.resolve({ make: input.make, model: input.model });
  if (!result.brandId) return input;

  const identity: CatalogIdentityMetadata = {
    version: 2,
    rawMake: result.rawMake,
    rawModel: result.rawModel,
    canonicalBrandId: result.brandId,
    canonicalModelId: result.modelId,
    makeSource: result.makeSource,
    modelSource: result.modelSource,
    fullyResolved: result.resolved,
  };

  return {
    ...input,
    make: result.canonicalMake,
    model: result.modelId ? result.canonicalModel : input.model,
    operational: {
      ...(input.operational || {}),
      encyclopediaIdentity: identity,
    },
  };
}
