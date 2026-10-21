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

// Compare paid full details, because list fields alone cannot establish absence.
for(const row of (data.result||[]).slice(0,3)){
 const id=String(row.inner_id);if(!/^\d+$/.test(id))continue;
 const detailUrl=new URL('https://api1.auto-api.com/api/v2/dubicars/offer');
 detailUrl.search=new URLSearchParams({api_key:process.env.AUTO_API_DUBICARS_KEY||'',inner_id:id}).toString();
 await assertCollectionEnabled('dubicars_feed');
 const response=await fetch(detailUrl,{redirect:'error',signal:AbortSignal.timeout(30000)});
 if(!response.ok)throw Error('provider_http_'+response.status);
 const raw=await response.json(),d=raw.data||raw.result?.data||raw.result||raw;
 if(String(d.inner_id)!==id)throw Error('detail_identity_mismatch');
 const technical=[];
 function scan(value,path='',depth=0){
  if(typeof value==='string'&&value.length<=128*1024){try{value=JSON.parse(value);}catch{return;}}
  if(!value||typeof value!=='object'||depth>4)return;
  for(const [key,v] of Object.entries(value)){
   const p=path+'.'+key;
   if(/power|horse|hp|engine|capacity|cylinder|displace/i.test(key)&&typeof v!=='object'&&String(v).length<60)technical.push({field:p,value:v});
   if(key==='extra'||key==='extra_prep'||v&&typeof v==='object')scan(v,p,depth+1);
  }
 }
 scan(d);
 console.log('DUBICARS_PAID_DETAIL',JSON.stringify({id,fields:Object.keys(d),technical:technical.slice(0,30)}));
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
