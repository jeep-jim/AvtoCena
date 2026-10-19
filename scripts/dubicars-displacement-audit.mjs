// Owner-requested bounded, read-only audit. No payloads, secrets or seller data in logs.
import {assertCollectionEnabled} from '../apps/web/lib/catalog/collection-controls.ts';
import {getOfferFromCurrentShard} from '../apps/web/lib/catalog/storage.ts';
import {normalizeAutoApiDubicars} from '../apps/web/lib/catalog/auto-api-dubicars.ts';
await assertCollectionEnabled('dubicars_feed');
async function read(endpoint,params){
 const url=new URL('https://api1.auto-api.com/api/v2/dubicars/'+endpoint);
 url.search=new URLSearchParams({...params,api_key:process.env.AUTO_API_DUBICARS_KEY||''}).toString();
 const r=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(30000)});
 if(!r.ok)throw Error('supplier_http_'+r.status);
 return r.json();
}
function summary(row){const d=row.data;const n=normalizeAutoApiDubicars(row);return {inner_id:row.inner_id,make:d.mark,model:d.model,displacement:d.displacement,normalizedEngineCc:n?.engineCc??null,power:d.power??null,engine_type:d.engine_type};}
const page=await read('offers',{page:'1'});
console.log('LIVE_SAMPLE',JSON.stringify({at:new Date().toISOString(),rows:(page.result||[]).slice(0,20).map(summary)}));
const stored=await getOfferFromCurrentShard('cb659e39eaf16e5dae6a8c36');
console.log('JAC_STORED',JSON.stringify(stored?{id:stored.id,sourceId:stored.sourceId,inner_id:stored.sourceOfferId,make:stored.make,model:stored.model,engineCc:stored.engineCc??null,sourceDisplacementLabel:stored.operational?.sourceDisplacementLabel??null,updatedAt:stored.updatedAt}:null));
if(stored?.sourceId==='dubicars_uae_exact'&&/^\d+$/.test(stored.sourceOfferId)){
 const raw=await read('offer',{inner_id:stored.sourceOfferId});
 const d=raw.data||raw.result?.data||raw.result||raw;
 if(String(d.inner_id)!==stored.sourceOfferId)throw Error('detail_identity_mismatch');
 console.log('JAC_LIVE',JSON.stringify(summary({inner_id:stored.sourceOfferId,data:d})));
}
const example={inner_id:'904588',data:{inner_id:'904588',url:'https://www.dubicars.com/2021-ram-1500-trx-904588.html',mark:'RAM',model:'1500 TRX',year:2021,displacement:6200,engine_type:'Бензин',images:[]}};
console.log('DOCUMENTATION_FIXTURE',JSON.stringify(summary(example)));
