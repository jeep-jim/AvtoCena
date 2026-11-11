import {readFileSync} from 'node:fs';
export const RELEASE_MARKETS=['china','korea','japan','europe','uae','georgia'];
export function releaseMarkets(value){
 if(value===undefined || value==='')return null;
 const markets=Array.isArray(value)?value:String(value).split(',');
 if(!markets.length||markets.some(m=>!RELEASE_MARKETS.includes(m))||new Set(markets).size!==markets.length)throw Error('release_market_scope_invalid');
 return markets;
}
export function markerMarkets(path){return releaseMarkets(JSON.parse(readFileSync(path,'utf8')).preparationMarkets);}
