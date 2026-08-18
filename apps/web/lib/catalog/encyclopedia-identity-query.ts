import type { CatalogSearchParams } from "./types";
import type { EncyclopediaIdentityResolver } from "./encyclopedia-identity";
import { readEncyclopediaIdentityResolver } from "./encyclopedia-identity-data";
import { effectiveCatalogEncyclopediaIdentityMode } from "./encyclopedia-identity-runtime";

function clean(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function makeValues(value: unknown) {
  return [...new Set(String(value || "").split(",").map(clean).filter(Boolean))];
}

/**
 * Keeps historical/bookmarked alias URLs usable after public projections switch
 * to canonical V2 naming. Only exact safe resolver matches are rewritten;
 * unresolved free text stays untouched so partial encyclopedia coverage never
 * makes an existing catalog search impossible.
 */
export function resolveCatalogSearchParamsWithEncyclopedia(
  resolver: EncyclopediaIdentityResolver,
  params: CatalogSearchParams,
): CatalogSearchParams {
  const rawMakes = makeValues(params.make);
  const resolvedMakes = rawMakes.map((make) => {
    const match = resolver.resolveBrand(make);
    return match ? { raw: make, brandId: match.brand.id, canonical: match.brand.canonicalName } : { raw: make, brandId: null, canonical: make };
  });
  const canonicalMakes = [...new Set(resolvedMakes.map((item) => item.canonical))];

  let model = params.model;
  if (model && resolvedMakes.length === 1 && resolvedMakes[0].brandId) {
    const match = resolver.resolveModel(resolvedMakes[0].brandId!, model);
    if (match) model = match.model.canonicalName;
  }

  return {
    ...params,
    make: rawMakes.length ? canonicalMakes.join(",") : params.make,
    model,
  };
}

/**
 * Public-query gate follows the effective manifest-controlled mode. Shadow/off
 * leave URLs untouched; apply rewrites only exact proven aliases.
 */
export async function resolveConfiguredCatalogSearchParams(params: CatalogSearchParams) {
  if (await effectiveCatalogEncyclopediaIdentityMode() !== "apply") return params;
  const resolver = await readEncyclopediaIdentityResolver();
  if (!resolver) throw new Error("catalog_encyclopedia_identity_query_dataset_unavailable");
  return resolveCatalogSearchParamsWithEncyclopedia(resolver, params);
}
