import 'server-only';
import {assertCollectionEnabled} from './collection-controls';
export async function usesAjesMarket(market:unknown,source?:unknown){
 // Owner 18.10.2026: China has one supplier, including old bookmarked URLs.
 if(market==='japan'||market==='china')return true;
 if(market!=='china'&&market!=='korea')return false;
 if(source==='ajes')return true;
 if(source==='existing')return false;
 try{await assertCollectionEnabled('ajes_korea_feed');return true;}catch{return false;}
}
