import {createAjesClient} from '../apps/web/lib/catalog/ajes-client';
import {ajesPassword} from '../apps/web/lib/catalog/ajes-settings';
import {assertCollectionEnabled} from '../apps/web/lib/catalog/collection-controls';
import {reserveAjesRequest} from '../apps/web/lib/catalog/ajes-quota';
import {getJsonStorage} from '../apps/web/lib/data';
async function main(){
 const ip=process.env.AJES_DIAG_IP;if(ip!=='151.248.113.177')throw Error('ip');
 let stage='setup';
 const client=createAjesClient({fetcher:async(url,options)=>{const r=await fetch(url,options);if(!r.ok){const body=(await r.clone().text()).slice(0,4096);const unknown=body.match(/Unknown column ['`]?([A-Za-z_]+)/i);console.log('AJES_HTTP_DIAGNOSTIC',JSON.stringify({stage,status:r.status,unknownColumn:unknown?.[1]||null,sqlError:/sql|syntax|database/i.test(body)}));}return r;},password:ajesPassword,assertEnabled:t=>assertCollectionEnabled(`ajes_${t}_feed`),reserve:t=>reserveAjesRequest(getJsonStorage(),t)});
 for(const table of ['korea','china'] as const){
  stage=table+':count';const count=await client.read({table,aggregate:'count'},ip);
  console.log('AJES_FILTERED_COUNT',JSON.stringify({table,total:count.total}));stage=table+':list';const list=await client.read({table,pageSize:2},ip);
  stage=table+':makes';const makes=await client.read({table,aggregate:'makes'},ip);
  const detail=list.items[0]?await client.read({table,id:list.items[0].id},ip):null;
  const first=list.items[0];
  if(first){
   stage=table+':model';const model=await client.read({table,make:first.make,model:first.model,pageSize:2},ip);
   stage=table+':page2';const next=await client.read({table,page:2,pageSize:2},ip);
   stage=table+':lot';const lot=/^\d{1,10}$/.test(first.lot)?await client.read({table,lotNumber:first.lot,pageSize:2},ip):null;
   console.log('AJES_STOCK_SEARCH',JSON.stringify({table,modelReceived:model.received,modelMatches:model.items.every((r:any)=>r.make===first.make&&r.model===first.model),nextPageReceived:next.received,pagesDisjoint:next.items.every((r:any)=>!list.items.some((v:any)=>v.id===r.id)),lotChecked:!!lot,lotReceived:lot?.received,lotMatches:lot?.items.every((r:any)=>r.lot===first.lot)}));
  }
  console.log('AJES_STOCK_CONTRACT',JSON.stringify({table,total:count.total,listReceived:list.received,listAccepted:list.items.length,makeRows:makes.received,detailReceived:detail?.received,detailAccepted:detail?.items.length,detailFuel:detail?.items[0]?.sourceFuel,detailPower:detail?.items[0]?.sourcePower,detailImageCount:detail?.items[0]?.images.length}));
 }
}
main().catch(e=>{console.log('AJES_STOCK_CHECK_FAILED',e?.reason||'local_failure');process.exitCode=1;});
