import {getJsonStorage} from '../../apps/web/lib/data';
import {createAjesClient} from '../../apps/web/lib/catalog/ajes-client';
import {ajesPassword} from '../../apps/web/lib/catalog/ajes-settings';
import {assertCollectionEnabled} from '../../apps/web/lib/catalog/collection-controls';
import {reserveAjesRequest} from '../../apps/web/lib/catalog/ajes-quota';

// Owner-requested three exact records. No crawl, endpoint rotation or cache writes.
async function main(){
 const ip=process.env.AJES_DIAG_IP;if(ip!=='151.248.113.177')throw Error('server_address_unconfirmed');
 const storage=getJsonStorage();
 for(const target of [{name:'Carnival',id:'6izvWQkzMx6Aed'},{name:'Casper',id:'6izzGEOo424cPs'},{name:'Grandeur-control',id:'6izzkyhPnLPcga'}]){
  const saved:any=await storage.readJson(`catalog/partner-cache/ajes/korea/${target.id}.json`,null);
  console.log('KOREA_DETAIL_CACHE_SHAPE',JSON.stringify({name:target.name,present:!!saved,page:saved?.page??null,pageSize:saved?.pageSize??null,schemaVersion:saved?.schemaVersion??null,fullInformation:saved?.fullInformation===true,ageSeconds:saved?Math.round((Date.now()-Date.parse(saved.observedAt))/1000):null,items:saved?.items?.length??null,exactIdentity:saved?.items?.length===1&&saved.items[0].table==='korea'&&saved.items[0].id===target.id}));
  let httpStatus:number|null=null;const startedAt=new Date().toISOString(),start=performance.now();
  const client=createAjesClient({password:ajesPassword,assertEnabled:()=>assertCollectionEnabled('ajes_korea_feed'),reserve:t=>reserveAjesRequest(storage,t),fetcher:async(input,init)=>{const response=await fetch(input,init);httpStatus=response.status;return response;}});
  try{
   const result=await client.read({table:'korea',id:target.id},ip);
   console.log('KOREA_DETAIL_DIRECT',JSON.stringify({name:target.name,startedAt,finishedAt:new Date().toISOString(),seconds:Math.round(performance.now()-start)/1000,httpStatus,items:result.items.length,received:result.received,rejected:result.rejected,exactIdentity:result.items.length===1&&result.items[0].id===target.id,stale:result.stale,outcome:'success'}));
  }catch(error:any){
   const reason=typeof error?.reason==='string'&&/^(visitor_restricted|request_failed|request_timeout|connect_timeout|invalid_response|empty_response|response_too_large|identity_mismatch|quota_exhausted|quota_busy|local_busy|http_\d{3})$/.test(error.reason)?error.reason:'other';
   console.log('KOREA_DETAIL_DIRECT',JSON.stringify({name:target.name,startedAt,finishedAt:new Date().toISOString(),seconds:Math.round(performance.now()-start)/1000,httpStatus,outcome:reason}));
   if(reason==='visitor_restricted'||reason==='quota_exhausted')break;
  }
 }
}
main().catch(()=>{console.log('KOREA_DETAIL_DIAGNOSTIC_FAILED');process.exitCode=1;});
