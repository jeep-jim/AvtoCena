import { canonicalCatalogBrand } from "./brands";
import type { EncyclopediaIdentityResolver } from "./encyclopedia-identity";
import type { VehicleOffer } from "./types";

const clean = (value: unknown) => String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();

/** Model identity is separate from proof of a priced modification. */
export function resolveKnowledgeModelIdentity(offer: VehicleOffer, resolver: EncyclopediaIdentityResolver) {
  const direct = resolver.resolve({ make: offer.make, model: offer.model });
  if (direct.modelId && !direct.ambiguous) return { modelId: direct.modelId, source: "canonical_or_safe_alias" };
  if (offer.sourceId !== "encar_direct" || offer.market !== "korea") {
    return { modelId: null, source: "unresolved" };
  }

  // Existing Encar bridge responses retain the exact list and detail payloads.
  // Do not translate free text or reuse a category from another listing.
  const raw = offer.operational?.raw as any;
  const list = raw?.offer;
  const category = raw?.detail?.category;
  if (!list || !category || clean(list.Id || list.CarId || list.carId) !== clean(offer.sourceOfferId)
    || clean(list.Manufacturer || list.ManufacturerName || list.maker) !== clean(category.manufacturerName)
    || clean(list.Model || list.ModelName) !== clean(category.modelName)
    || clean(offer.make) !== clean(category.manufacturerName)
    || clean(offer.model) !== clean(category.modelName)) {
    return { modelId: null, source: "unresolved", reason: "encar_category_identity_unproven" };
  }
  const make = canonicalCatalogBrand(clean(category.manufacturerName));
  const exactNative = resolver.resolve({ make, model: category.modelName });
  if (exactNative.modelId && !exactNative.ambiguous) {
    return { modelId: exactNative.modelId, source: "encar_exact_detail_native_name" };
  }
  // Encar groups can contain DIFFERENT models: Grand Cherokee is in Cherokee.
  // Only a plain group name with an explicit generation suffix is equivalent.
  const withoutGeneration = clean(category.modelName)
    .replace(/\s+(?:\d+세대|[A-Z]\d{2,3}|\([A-Z0-9]+\))$/u, "");
  if (withoutGeneration !== clean(category.modelGroupName)) {
    return { modelId: null, source: "unresolved", reason: "encar_model_group_is_broader_than_model" };
  }
  let model = clean(category.modelGroupEnglishName);
  if (make === "Mercedes-Benz") model = model.replace(/^(GL[ABCES])-Class$/i, "$1");
  const resolved = resolver.resolve({ make, model });
  return {
    modelId: resolved.ambiguous ? null : resolved.modelId,
    source: resolved.modelId && !resolved.ambiguous ? "encar_exact_detail_model_group" : "unresolved",
    sourceMake: clean(category.manufacturerName),
    sourceModel: clean(category.modelName),
    sourceModelGroup: clean(category.modelGroupName),
    sourceEnglishModelGroup: clean(category.modelGroupEnglishName),
    // These are lookup keys, never a substitute for a verified specification.
    sourceVariantCodes: Object.fromEntries(["manufacturerCd", "modelCd", "gradeCd", "gradeDetailCd", "jatoVehicleId"]
      .filter(key => category[key] != null).map(key => [key, clean(category[key])])),
  };
}
