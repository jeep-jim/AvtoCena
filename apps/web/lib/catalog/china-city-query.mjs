import assert from 'node:assert/strict';

/** A delivery-only city must not turn canonical pagination into a whole-city
 * join/sort. Select IDs with the already verified immutable reader, then ask
 * that same reader for each selected ID's saved city price. Price filters and
 * price ordering retain the original query and its exact SQL semantics. */
export function queryChinaWithPreparedCity(reader, params = {}) {
  const cityKey = params?.cityKey;
  const priceFilter = params?.hasPrice !== undefined ||
    params?.budgetFrom !== undefined && params.budgetFrom !== 0 ||
    params?.budgetTo !== undefined && params.budgetTo !== 0;
  const priceSort = String(params?.sort ?? '').split(',').some(term => term === 'totalRub' || term === 'totalRubDesc');
  if (cityKey === undefined || priceFilter || priceSort && !params.countOnly) return reader.query(params);

  assert(reader.manifest.cityKeys.includes(cityKey), 'china_query_city_not_prepared');
  const {cityKey: _city, ...selection} = params;
  const result = reader.query(selection);
  if (params.countOnly) return result;
  const items = result.items.map(item => {
    // get() preserves the same file/authority fences and returns the frozen
    // projection, detail locator and city price; no mutable storage or FX.
    const saved = reader.get(item.id, cityKey);
    assert(saved, 'china_query_city_price_missing');
    return saved;
  });
  return {...result, items};
}
