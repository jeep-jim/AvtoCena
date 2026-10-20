import {prepareModelSuggestionSearch, type ModelSearchData} from './model-suggestion-search';
import modelSearchAsset from './model-search-asset.json';

type Search = Awaited<ReturnType<typeof prepareModelSuggestionSearch>>;
const requests = new Map<string, {expires: number; promise: Promise<Search>}>();

// Share downloads across desktop/mobile controls; never leave an unresolved
// fetch cached forever. Runtime inventory is refreshed independently of builds.
export function loadModelSuggestions(inventory = false, source?: {market:string;make:string}, make = '', market = ''): Promise<Search> {
  const url = source ? '/api/catalog/source-models?'+new URLSearchParams(source) : inventory ? '/api/catalog/models?'+new URLSearchParams({scope:'inventory'}) : modelSearchAsset.asset;
  const cached = requests.get(url);
  if (cached && cached.expires > Date.now()) return cached.promise;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), source ? 30_000 : 12_000);
  const promise = fetch(url, {cache: inventory || source ? 'no-store' : 'force-cache', signal: controller.signal})
    .then(async response => {
      if (!response.ok) throw Error('directory_unavailable');
      const data = await response.json() as ModelSearchData;
      if (data.version !== 1 || !Array.isArray(data.models) || !Array.isArray(data.brands)
        || (!inventory && !source && !data.models.length)) throw Error('invalid_directory');
      return prepareModelSuggestionSearch(data);
    }).catch(error => { if (requests.get(url)?.promise === promise) requests.delete(url); throw error; })
    .finally(() => clearTimeout(timeout));
  requests.set(url, {expires: Date.now() + (inventory || source ? 60_000 : 3600_000), promise});
  return promise;
}
