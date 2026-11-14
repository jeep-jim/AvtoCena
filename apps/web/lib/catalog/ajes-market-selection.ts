import 'server-only';
import {assertCollectionEnabled} from './collection-controls';
export async function usesAjesMarket(market:unknown,source?:unknown){
 // The current owner switch also governs old bookmarked China URLs.
 if(market==='japan')return true;
 if(market==='china'){
  try{await assertCollectionEnabled('ajes_china_feed');return true;}catch{return false;}
 }
 if(market!=='korea')return false;
 // Until the actual manifest identifies a fully paid snapshot, keep serving AJ.
 try { await assertCollectionEnabled('encar_feed'); }
 catch { return true; }
 const {hasPublishedPaidEncar}=await import('./storage');
 return !await hasPublishedPaidEncar();
}
