import 'server-only';
import {assertCollectionEnabled} from './collection-controls';
export async function usesAjesMarket(market:unknown,source?:unknown){
 // The current owner switch also governs old bookmarked China URLs.
 if(market==='japan')return true;
 if(market==='china'){
  try{await assertCollectionEnabled('ajes_china_feed');return true;}catch{return false;}
 }
 // Korea has one purchased Encar feed, including legacy bookmarks.
 return market==='korea';
}
