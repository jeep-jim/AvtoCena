import {readGreenCorner} from './green-corner';
import {selectedCatalogMarkets} from './market-selection';
import {readPreparedChinaHomeCards} from './prepared-china-http-fixture';
import {PUBLIC_CATALOG_MARKETS} from './runtime-config';
import {catalogMakeFilterValues, readCatalogModelNames} from './storage';

export async function publishedModelSuggestions(make: string, market: string) {
 const requested = selectedCatalogMarkets(market);
 const markets = requested.length ? requested : PUBLIC_CATALOG_MARKETS;
 const wantsChina = markets.includes('china');
 const legacyMarkets = markets.filter(m => m !== 'green' && m !== 'china');
 const [china, other, green] = await Promise.all([
  wantsChina ? readPreparedChinaHomeCards(0, {navigation:true}) : null,
  legacyMarkets.length ? readCatalogModelNames(make, legacyMarkets.join('|')) : [],
  requested.includes('green') ? readGreenCorner().then(result => result.items) : [],
 ]);
 if (china && !china.facets) throw Error('china_model_directory_unavailable');
 const chinaRows = wantsChina ? china?.facets?.models ?? await readCatalogModelNames(make, 'china') : [];
 const normalize = (value: string) => value.trim().toLocaleLowerCase('ru-RU');
 const makes = new Set(catalogMakeFilterValues(make).map(normalize));
 const models = new Map<string, [string, string, string[], number]>();
 for (const row of [...chinaRows, ...other, ...green]) {
  if (!row.make || !row.model || (makes.size && !makes.has(normalize(row.make)))) continue;
  const key = JSON.stringify([normalize(row.make), normalize(row.model)]);
  models.set(key, [row.make, row.model, [], 1]);
 }
 return {version:1, brands:[], models:[...models.values()]};
}
