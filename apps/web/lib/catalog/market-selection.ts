import {filterSelections} from './filter-selections';
import {PUBLIC_CATALOG_MARKETS} from './runtime-config';
export function selectedCatalogMarkets(value:unknown){
 return filterSelections(value).filter(m=>m==='green'||PUBLIC_CATALOG_MARKETS.includes(m as any));
}
/** A power count spans separate published inventories, including local Japanese stock. */
export function countRequestMarkets(params: URLSearchParams, independentChina: boolean) {
 const market = params.get('market');
 const allMarkets = !market || market === 'any';
 const hasPower = [params.get('powerFrom'), params.get('powerTo')].some(value =>
  value !== null && Number.isFinite(Number(value)) && Number(value) > 0);
 if (independentChina && allMarkets && hasPower && !params.get('source') && !params.get('stock')) {
  return [...PUBLIC_CATALOG_MARKETS, 'green'];
 }
 return selectedCatalogMarkets(market);
}
/** Only source-backed markets extend the inventory/encyclopedia picker. */
export function modelDirectoryMarkets(value:unknown,make:string,ajesChina=false){
 const selected=selectedCatalogMarkets(value);
 return selected.length?selected.filter(m=>m==='korea'||m==='japan'||(m==='china'&&ajesChina)):make?['korea','japan']:[];
}
export function marketSelectionUrl(url:URL,market:string){
 const next=new URL(url);next.searchParams.set('market',market==='green'?'japan':market);
 next.searchParams.delete('stock');next.searchParams.delete('source');
 if(market==='green')next.searchParams.set('stock','green');
 return next;
}
