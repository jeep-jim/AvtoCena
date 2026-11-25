/** Browser-specific selection policy for an immutable, city-priced China detail.
 * The explicit city in the catalog URL is authoritative until the visitor
 * intentionally edits it. Global localStorage must not silently replace it. */
export function isPreparedChinaDetailCity(prepared: boolean, market: string | null | undefined, requestedCity: string | null | undefined): boolean {
  return prepared === true && market === 'china' && typeof requestedCity === 'string' && requestedCity.trim().length > 0;
}
export function detailCityStoragePolicy({
  pinnedPreparedCity = false, initialScenario = false, localCitySelection = false,
  canSave = false, localCityEdited = false,
}: {
  pinnedPreparedCity?: boolean; initialScenario?: boolean; localCitySelection?: boolean;
  canSave?: boolean; localCityEdited?: boolean;
}) {
  const privateCity = pinnedPreparedCity || initialScenario ||
    ((localCitySelection || canSave) && localCityEdited);
  return {
    syncStored: !privateCity,
    syncStoredOnMount: !initialScenario && !pinnedPreparedCity,
    persistSelection: !localCitySelection && !canSave && !initialScenario && !pinnedPreparedCity,
  };
}
