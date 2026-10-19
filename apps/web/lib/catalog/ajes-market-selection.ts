import 'server-only';
import {assertCollectionEnabled} from './collection-controls';
export async function usesAjesMarket(market:unknown,source?:unknown){
 // The current owner switch also governs old bookmarked China URLs.
 if(market==='japan')return true;
 if(market==='china'){
  try{await assertCollectionEnabled('ajes_china_feed');return true;}catch{return false;}
 }
 if(market!=='china'&&market!=='korea')return false;
 if(source==='ajes')return true;
 if(source==='existing')return false;
 try{await assertCollectionEnabled('ajes_korea_feed');return true;}catch{return false;}
}
