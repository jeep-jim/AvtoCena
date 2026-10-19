import {assertCollectionEnabled} from '../apps/web/lib/catalog/collection-controls.ts';
await assertCollectionEnabled('dubicars_feed');
// Manual read-only schema check: never log payloads, credentials, descriptions or seller data.
const url=new URL('https://api1.auto-api.com/api/v2/dubicars/offers');
url.search=new URLSearchParams({api_key:process.env.AUTO_API_DUBICARS_KEY||'',page:'1'}).toString();
const r=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(30000)});
if(!r.ok)throw Error('provider_http_'+r.status);
const data=await r.json();
for(const row of (data.result||[]).slice(0,3)){
 const d=row.data||{};
 console.log('DUBICARS_FIELDS',JSON.stringify({fields:Object.keys(d),extraKeys:d.extra&&typeof d.extra==='object'?Object.keys(d.extra):[],technical:Object.fromEntries(['displacement','power','power_hp','horsepower','engine_power','engine_type'].filter(k=>k in d).map(k=>[k,d[k]])),hasSourceUrl:typeof d.url==='string'}));
}
