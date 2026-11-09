import {readFileSync} from 'node:fs';
export const RELEASE_MARKETS=['china','korea','japan','europe','uae','georgia'];
export const HOME_OVERVIEW_MARKETS=RELEASE_MARKETS.filter(market=>market!=='japan');
export function releaseMarkets(value){
 if(value===undefined || value==='')return null;
 const markets=Array.isArray(value)?value:String(value).split(',');
 if(!markets.length||markets.some(m=>!RELEASE_MARKETS.includes(m))||new Set(markets).size!==markets.length)throw Error('release_market_scope_invalid');
 return markets;
}
export function markerMarkets(path){return releaseMarkets(JSON.parse(readFileSync(path,'utf8')).preparationMarkets);}
export function markerHomeCatalog(path){
 const value=JSON.parse(readFileSync(path,'utf8')).requireHomeCatalog;
 if(value!==undefined&&typeof value!=='boolean')throw Error('release_home_catalog_flag_invalid');
 return value===true;
}
export function releaseHomeCatalogFlag(value){
 if(value===undefined||value===''||value==='0')return false;
 if(value==='1')return true;
 throw Error('release_home_catalog_flag_invalid');
}
/** Home releases build the complete shared overview from every saved source
 * projection, including retained Japan data. No supplier is contacted here.
 * Ordinary market-only
 * releases retain their independent landing preparation and never write overview.
 */
export function generationPagePreparation(value,requireHomeCatalog=false){
 const selected=releaseMarkets(value);
 return {
  markets:requireHomeCatalog?[...new Set([...(selected||RELEASE_MARKETS),...RELEASE_MARKETS])]:selected||RELEASE_MARKETS,
  landingsOnly:Boolean(selected)&&!requireHomeCatalog,
 };
}
