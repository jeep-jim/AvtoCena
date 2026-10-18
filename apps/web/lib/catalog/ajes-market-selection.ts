import 'server-only';
import {assertCollectionEnabled} from './collection-controls';
export async function usesAjesMarket(market:unknown,source?:unknown){
 if(market==='japan')return true;
 if(market!=='china'&&market!=='korea')return false;
 if(source==='ajes')return true;
 if(source==='existing'||market==='china')return false;
 try{await assertCollectionEnabled('ajes_korea_feed');return true;}catch{return false;}
}
