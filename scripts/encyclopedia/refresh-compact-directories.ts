import {createAjesClient} from '../../apps/web/lib/catalog/ajes-client';
import {ajesPassword} from '../../apps/web/lib/catalog/ajes-settings';
import {ajesQuery} from '../../apps/web/lib/catalog/ajes-query';
import {assertCollectionEnabled,readCollectionControls} from '../../apps/web/lib/catalog/collection-controls';
import {reserveAjesRequest} from '../../apps/web/lib/catalog/ajes-quota';
import {getJsonStorage} from '../../apps/web/lib/data';
// One owner-requested aggregate directory refresh. No listing/detail calls or retries.
async function main(){
 const ip=process.env.AJES_DIAG_IP;
 if(ip!=='151.248.113.177')throw Error('diagnostic_address_invalid');
 const store=getJsonStorage();if(store.driver!=='object')throw Error('durable_object_storage_required');
 const controls=await readCollectionControls();
 const client=createAjesClient({password:ajesPassword,assertEnabled:t=>assertCollectionEnabled(`ajes_${t==='korea'?'korea':'japan'}_feed`),reserve:t=>reserveAjesRequest(store,t)});
 for(const [table,market] of [['stats','japan'],['korea','korea']] as const){
  if(controls.markets[market]?.enabled===false||controls.sources[`ajes_${market}_feed`]?.enabled===false)continue;
  const pages=[];let complete=false;const seen=new Set<string>();
  for(let page=1;page<=10;page++){
   const query={table,aggregate:'models' as const,page};
   const value=await client.read(query,ip);
   if(value.stale||value.partial||!Array.isArray(value.models)||value.models.length!==value.received)throw Error('incomplete_directory');
   for(const row of value.models){const key=JSON.stringify([row.make,row.model]);if(seen.has(key))throw Error('directory_page_repeated');seen.add(key);}
   pages.push({sql:ajesQuery(query).sql,value});
   if(value.received<500){complete=true;break;}
  }
  if(!complete)throw Error('directory_too_large');
  await store.writeJson(`catalog/partner-cache/ajes/compact-directory/${market}.json`,{complete:true,capturedAt:new Date().toISOString(),pages});
  console.log(JSON.stringify({market,pages:pages.length,models:seen.size,complete:true}));
 }
}
main().catch(e=>{console.error('compact_directory_refresh_failed',/^[a-z_0-9]+$/.test(e?.reason||e?.message||'')?(e.reason||e.message):'local_failure');process.exitCode=1;});
