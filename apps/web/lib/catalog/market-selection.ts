import {filterSelections} from './filter-selections';
import {PUBLIC_CATALOG_MARKETS} from './runtime-config';
export function selectedCatalogMarkets(value:unknown){
 return filterSelections(value).filter(m=>m==='green'||PUBLIC_CATALOG_MARKETS.includes(m as any));
}
export function marketSelectionUrl(url:URL,market:string){
 const next=new URL(url);next.searchParams.set('market',market==='green'?'japan':market);
 next.searchParams.delete('stock');next.searchParams.delete('source');
 if(market==='green')next.searchParams.set('stock','green');
 return next;
}
