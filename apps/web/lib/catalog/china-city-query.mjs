import assert from 'node:assert/strict';

/** A delivery-only city must not turn canonical pagination into a whole-city
 * join/sort. Select IDs with the already verified immutable reader, then read
 * those IDs' saved city prices from its verified file. Price filters and
 * price ordering retain the original query and its exact SQL semantics. */
export function queryChinaWithPreparedCity(reader, params = {}, cityPricesById, readCityPrices) {
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
  const prepared = readCityPrices?.(result.items.map(item => item.id));
  const items = result.items.map(item => {
    // The selected projection and locator are already hydrated. Read each
    // saved scalar price map once with the same file/authority fences; the
    // native reader also needs it for the card's client-side city controls.
    const prices = prepared ? prepared.get(item.id) : reader.cityPrices(item.id);
    assert(prices && Object.hasOwn(prices, cityKey), 'china_query_city_price_missing');
    cityPricesById?.set(item.id, prices);
    return {...item, queryRub: prices[cityKey]};
  });
  return {...result, items};
}
