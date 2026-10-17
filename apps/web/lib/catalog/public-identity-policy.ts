import { canonicalCatalogBrand, catalogBrandBySlug, catalogBrandSlug } from "./brands";

type PublicIdentityCarrier = {
  market?: unknown;
  make?: unknown;
  model?: unknown;
  encyclopediaDisplayIdentity?: { modelId?: unknown };
};

const UNSUPPORTED_IMPORT_BRANDS = new Set([
  "aurus",
  "gaz",
  "lada",
  "moskvich",
  "uaz",
  "vaz",
]);

function cleanKey(value: unknown) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function containsUnresolvedSourceScript(value: unknown) {
  return /[\p{Script=Han}\p{Script=Hangul}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(String(value || ""));
}

const LEGITIMATE_NUMERIC_MODELS: Record<string, Set<string>> = {
  ds: new Set(["3", "4", "7", "9"]),
  mazda: new Set(["2", "3", "5", "6"]),
  polestar: new Set(["1", "2", "3", "4", "5", "6"]),
  renault: new Set(["4", "5"]),
  tesla: new Set(["3"]),
};

function malformedPublicModelReason(makeValue: unknown, modelValue: unknown, provenModel: boolean) {
  const make = canonicalCatalogBrand(String(makeValue || ""));
  const model = String(modelValue || "").normalize("NFKC").replace(/\s+/g, " ").trim();
  if (!model) return "missing_public_model";
  if (/^\([^()]{1,24}\)$/.test(model)) return "internal_model_code_only";
  if (/^(?:I|II|III|IV|V|VI|VII|VIII|IX|X)$/i.test(model)) return "incomplete_roman_model";
  if (/^\d{1,2}$/.test(model) && !provenModel && !LEGITIMATE_NUMERIC_MODELS[cleanKey(make)]?.has(model)) return "unproven_numeric_model";
  if (cleanKey(model) === cleanKey(make)) return "model_duplicates_make";
  return "";
}

export function publicCatalogIdentityRejectionReason(offer: PublicIdentityCarrier) {
  const canonicalMake = canonicalCatalogBrand(String(offer?.make || ""));
  const provenModel = Boolean(String(offer?.encyclopediaDisplayIdentity?.modelId || ""));
  if (UNSUPPORTED_IMPORT_BRANDS.has(cleanKey(canonicalMake))) return "unsupported_import_brand";
  if (containsUnresolvedSourceScript(canonicalMake) || containsUnresolvedSourceScript(offer?.model)) return "unresolved_source_language_identity";
  const malformedModel = malformedPublicModelReason(canonicalMake, offer?.model, provenModel);
  if (malformedModel) return malformedModel;

  if (String(offer?.market || "").toLowerCase() === "china") {
    const knownBrand = catalogBrandBySlug(catalogBrandSlug(canonicalMake));
    // China sources mix manufacturers, conversion ateliers and sales names in
    // one make field. An unknown public make is therefore fail-closed unless a
    // canonical model in the maintained vehicle directory proves its identity.
    if (!knownBrand && !provenModel) return "unresolved_china_make";
  }
  return "";
}

export function isSupportedPublicCatalogIdentity(offer: PublicIdentityCarrier) {
  return !publicCatalogIdentityRejectionReason(offer);
}
