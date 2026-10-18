import {createAjesClient} from '../apps/web/lib/catalog/ajes-client';
import {ajesPassword} from '../apps/web/lib/catalog/ajes-settings';
import {assertCollectionEnabled} from '../apps/web/lib/catalog/collection-controls';
import {reserveAjesRequest} from '../apps/web/lib/catalog/ajes-quota';
import {getJsonStorage} from '../apps/web/lib/data';
async function main(){
 const ip=process.env.AJES_DIAG_IP;if(ip!=='151.248.113.177')throw Error('ip');
 const client=createAjesClient({password:ajesPassword,assertEnabled:t=>assertCollectionEnabled(`ajes_${t}_feed`),reserve:t=>reserveAjesRequest(getJsonStorage(),t)});
 for(const table of ['korea','china'] as const){
  const count=await client.read({table,aggregate:'count'},ip);
  const list=await client.read({table,pageSize:2},ip);
  const makes=await client.read({table,aggregate:'makes'},ip);
  const detail=list.items[0]?await client.read({table,id:list.items[0].id},ip):null;
  console.log('AJES_STOCK_CONTRACT',JSON.stringify({table,total:count.total,listReceived:list.received,listAccepted:list.items.length,makeRows:makes.received,detailReceived:detail?.received,detailAccepted:detail?.items.length,detailFuel:detail?.items[0]?.sourceFuel,detailPower:detail?.items[0]?.sourcePower,detailImageCount:detail?.items[0]?.images.length}));
 }
}
main().catch(e=>{console.log('AJES_STOCK_CHECK_FAILED',e?.reason||'local_failure');process.exitCode=1;});
