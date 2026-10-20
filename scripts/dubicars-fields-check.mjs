import {assertCollectionEnabled} from '../apps/web/lib/catalog/collection-controls.ts';
await assertCollectionEnabled('dubicars_feed');
// Manual read-only schema check: never log payloads, credentials, descriptions or seller data.
const url=new URL('https://api1.auto-api.com/api/v2/dubicars/offers');
url.search=new URLSearchParams({api_key:process.env.AUTO_API_DUBICARS_KEY||'',page:'1'}).toString();
const r=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(30000)});
if(!r.ok)throw Error('provider_http_'+r.status);
const data=await r.json();
for(const row of (data.result||[]).slice(0,20)){
 const d=row.data||{};
 let extra=d.extra_prep;
 if(typeof extra==='string'){try{extra=JSON.parse(extra);}catch{extra=null;}}
 const fields=[];
 function scan(value,path='',depth=0){if(!value||typeof value!=='object'||depth>4)return;for(const [key,v] of Object.entries(value)){const p=path+'.'+key;if(/power|horse|hp|engine|capacity|cylinder|displace/i.test(key)&&typeof v!=='object'&&String(v).length<60)fields.push({field:p,value:v});if(v&&typeof v==='object')scan(v,p,depth+1);}}
 scan(extra);
 console.log('DUBICARS_EXTRA_SCHEMA',JSON.stringify({kind:typeof d.extra_prep,keys:extra&&typeof extra==='object'?Object.keys(extra):[],technical:fields.slice(0,30)}));
 console.log('DUBICARS_FIELDS',JSON.stringify({fields:Object.keys(d),extraKeys:d.extra&&typeof d.extra==='object'?Object.keys(d.extra):[],technical:Object.fromEntries(['displacement','power','power_hp','horsepower','engine_power','engine_type'].filter(k=>k in d).map(k=>[k,d[k]])),hasSourceUrl:typeof d.url==='string'}));
}

const {DubicarsCurrentAdapter}=await import('../apps/web/lib/catalog/dubicars-current-source.ts');
const {normalizeAutoApiDubicars}=await import('../apps/web/lib/catalog/auto-api-dubicars.ts');
// Exact same listing only, stop on source refusal. No alternate routes or retries.
for(const row of (data.result||[]).slice(0,2)){
 const offer=normalizeAutoApiDubicars(row);if(!offer)continue;
 try {
  const refreshed=await new DubicarsCurrentAdapter().refreshOffer(offer);
  console.log('DUBICARS_DETAIL_POWER',JSON.stringify({id:offer.sourceOfferId,powerHp:refreshed.powerHp??null,evidence:refreshed.operational?.semanticEvidence?.powerHp}));
 }catch(e){console.log('DUBICARS_DETAIL_STOP',JSON.stringify({id:offer.sourceOfferId,reason:/^[a-z_0-9:]+$/.test(String(e?.message))?e.message:'source_detail_failed'}));break;}
}
