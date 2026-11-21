import {filterSelections} from './filter-selections';
import {PUBLIC_CATALOG_MARKETS} from './runtime-config';
export function selectedCatalogMarkets(value:unknown){
 return filterSelections(value).filter(m=>m==='green'||PUBLIC_CATALOG_MARKETS.includes(m as any));
}
/** Japan is the only catalogue whose model directory is served on demand. */
export function modelDirectoryMarkets(value: unknown, make: string) {
 const markets = selectedCatalogMarkets(value);
 const includeJapan = markets.length ? markets.includes('japan') : Boolean(make);
 return includeJapan ? ['japan'] : [];
}
export function inventoryDirectoryScopes(value: unknown) {
 const selected = selectedCatalogMarkets(value);
 const markets = selected.length ? selected : PUBLIC_CATALOG_MARKETS;
 // The independent China publication can arrive before or after the shared
 // summary. Green stock already has a dedicated picker request.
 const shared = markets.filter(m => m !== 'china' && m !== 'green').join('|');
 return [shared, markets.includes('china') ? 'china' : ''].filter(Boolean);
}
export function marketSelectionUrl(url:URL,market:string){
 const next=new URL(url);next.searchParams.set('market',market==='green'?'japan':market);
 next.searchParams.delete('stock');next.searchParams.delete('source');
 if(market==='green')next.searchParams.set('stock','green');
 return next;
}
