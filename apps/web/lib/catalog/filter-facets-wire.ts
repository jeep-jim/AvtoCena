/**
 * The ordinary catalog picker loads its complete model directory on opening.
 * Its server facets.models array is not consumed by CatalogFilters, so shipping
 * that second directory in every page/navigation response is unnecessary.
 * Source-only/auction pickers retain their model rows and all other facets stay
 * unchanged. This is a transport projection, never an inventory/data mutation.
 */
export function catalogFilterFacetsForClient<T extends {models?: unknown[]}>(facets:T,usesSourceModels=false):T {
  return usesSourceModels || !facets.models?.length ? facets : {...facets,models:[]};
}
