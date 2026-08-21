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

export function publicCatalogIdentityRejectionReason(offer: PublicIdentityCarrier) {
  const canonicalMake = canonicalCatalogBrand(String(offer?.make || ""));
  if (UNSUPPORTED_IMPORT_BRANDS.has(cleanKey(canonicalMake))) return "unsupported_import_brand";
  if (containsUnresolvedSourceScript(canonicalMake) || containsUnresolvedSourceScript(offer?.model)) return "unresolved_source_language_identity";

  if (String(offer?.market || "").toLowerCase() === "china") {
    const knownBrand = catalogBrandBySlug(catalogBrandSlug(canonicalMake));
    const provenModel = Boolean(String(offer?.encyclopediaDisplayIdentity?.modelId || ""));
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
