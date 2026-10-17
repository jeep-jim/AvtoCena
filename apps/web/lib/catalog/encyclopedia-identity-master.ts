import type { EncyclopediaIdentityResolver } from "./encyclopedia-identity";
import { applyEncyclopediaIdentity, type IdentityApplied } from "./encyclopedia-identity-application";
import { presentCatalogOffer } from "./presentation";

type IdentityCarrier = {
  make: string;
  model: string;
  operational?: Record<string, unknown>;
  [key: string]: unknown;
};

function clean(value: unknown) {
  return String(value || "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function identityMeta(value: any) {
  return value?.operational?.encyclopediaIdentity as {
    rawMake?: string;
    rawModel?: string;
    canonicalBrandId?: string | null;
    canonicalModelId?: string | null;
    makeSource?: string;
    modelSource?: string;
    fullyResolved?: boolean;
    ambiguous?: boolean;
  } | undefined;
}

function preserveRawIdentity<T extends IdentityCarrier>(
  result: IdentityApplied<T>,
  raw: T,
  stage: "raw" | "presentation",
): IdentityApplied<T> {
  const current = identityMeta(result) || {};
  return {
    ...result,
    operational: {
      ...(result.operational || {}),
      encyclopediaIdentity: {
        version: 2,
        rawMake: clean(raw.make),
        rawModel: clean(raw.model),
        canonicalBrandId: current.canonicalBrandId ?? null,
        canonicalModelId: current.canonicalModelId ?? null,
        makeSource: stage === "presentation" && current.makeSource && current.makeSource !== "unresolved"
          ? `presentation:${current.makeSource}`
          : String(current.makeSource || "unresolved"),
        modelSource: stage === "presentation" && current.modelSource && current.modelSource !== "unresolved"
          ? `presentation:${current.modelSource}`
          : String(current.modelSource || "unresolved"),
        fullyResolved: current.fullyResolved === true,
        ambiguous: current.ambiguous === true,
      },
    },
  } as IdentityApplied<T>;
}

/**
 * Canonical production identity is always chosen by the strict Encyclopedia V2
 * resolver. Presentation translation may only provide another exact lookup
 * candidate; it never becomes model authority by itself.
 *
 * This matters for China/Korea: a source string may first be translated to a
 * Latin market label, but that label is persisted only when Encyclopedia V2
 * resolves it uniquely to a canonical model. Brand-only translation may
 * canonicalize the brand while the raw source model is retained unresolved.
 */
export function applyEncyclopediaIdentityMaster<T extends IdentityCarrier>(
  resolver: EncyclopediaIdentityResolver,
  input: T,
): IdentityApplied<T> {
  const direct = preserveRawIdentity(applyEncyclopediaIdentity(resolver, input), input, "raw");
  const directMeta = identityMeta(direct);
  if (directMeta?.canonicalModelId) return direct;

  const presented = presentCatalogOffer(input);
  const translatedMake = clean(presented.makeLabel || input.make);
  const translatedModel = clean(presented.modelLabel || input.model);
  const sourceMake = clean(input.make);
  const sourceModel = clean(input.model);
  if ((!translatedMake && !translatedModel)
    || (translatedMake === sourceMake && translatedModel === sourceModel)) return direct;

  const translatedCandidate = {
    ...input,
    make: translatedMake || sourceMake,
    model: translatedModel || sourceModel,
  } as T;
  const translated = preserveRawIdentity(
    applyEncyclopediaIdentity(resolver, translatedCandidate),
    input,
    "presentation",
  );
  const translatedMeta = identityMeta(translated);

  // Only the encyclopedia may authorize a translated model name.
  if (translatedMeta?.canonicalModelId) return translated;

  // A translated make may still safely collapse duplicate/localized brand
  // spellings. Keep the original source model until V2 can identify it.
  if (!directMeta?.canonicalBrandId && translatedMeta?.canonicalBrandId) {
    const brandOnlyCandidate = {
      ...input,
      make: translatedMake || sourceMake,
      model: sourceModel,
    } as T;
    return preserveRawIdentity(
      applyEncyclopediaIdentity(resolver, brandOnlyCandidate),
      input,
      "presentation",
    );
  }

  return direct;
}
