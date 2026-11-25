// Narrow read-only Japan acceptance: one page of 24 (AJ's permitted query size),
// one detail already present on that page, plus one bounded power-filter request.
// No direct supplier calls, no spoofed visitor IP and no bulk traversal.
import assert from 'node:assert/strict';
const base='https://avtocena.com';
const result={kind:'japan-aj-one-page-verification-v1',source:'public-site',
 visitorIpSpoofed:false,sourceDumpRequests:0,steps:[]};
async function request(path,html=false) {
 const started=Date.now();
 const response=await fetch(base+path,{headers:{Accept:html?'text/html':'application/json'},
   redirect:'error',cache:'no-store',signal:AbortSignal.timeout(27000)});
 const max=html?2*1024*1024:600000;
 const chunks=[];let total=0;
 for await(const part of response.body??[]){
   total+=part.byteLength;if(total>max)throw Error('response_too_large');
   chunks.push(Buffer.from(part));
 }
 const bytes=Buffer.concat(chunks),body=html?bytes.toString('utf8'):JSON.parse(bytes.toString('utf8'));
 return {status:response.status,elapsedMs:Date.now()-started,body};
}
try {
 const list=await request('/api/catalog/search?market=japan&page=1&pageSize=24&yearFrom=2008');
 const rows=Array.isArray(list.body?.items)?list.body.items:[];
 const exact=rows.filter(r=>Number.isFinite(r?.powerHp)&&r.powerHp>0);
 const values=rows.filter(r=>Array.isArray(r?.japanPowerEstimate?.values)&&r.japanPowerEstimate.values.length);
 result.steps.push({name:'japanPage24',status:list.status,elapsedMs:list.elapsedMs,count:rows.length,
  qualifiedJapanRows:rows.filter(r=>r?.market==='japan').length,
  exactPowerRows:exact.length,exactPowerTo160:exact.filter(r=>r.powerHp<=160).length,
  preliminaryPowerRows:values.length,stale:list.body?.stale===true,
  partial:list.body?.partial===true});
 assert.equal(list.status,200,'list_http');assert.equal(list.body?.ok,true,'list_failed');
 assert.equal(rows.length>0,true,'no_rows');
 assert.equal(rows.every(r=>r?.market==='japan'),true,'foreign_market');
 const id=rows.find(r=>/^ajes-stats-[A-Za-z0-9_-]{1,64}$/.test(String(r?.id||'')))?.id;
 if(id) {
   const detail=await request('/cars/offer/'+encodeURIComponent(id),true);
   result.steps.push({name:'offerDetail',status:detail.status,elapsedMs:detail.elapsedMs,
    hasRubPrice:detail.body.includes('₽'),japanText:detail.body.includes('Япония')});
   assert.equal(detail.status,200,'detail_http');
   assert.equal(detail.body.includes('₽'),true,'detail_price');
 } else result.steps.push({name:'offerDetail',result:'no_ajes_stats_id_in_sample'});
 const filtered=await request('/api/catalog/search?market=japan&page=1&pageSize=24&yearFrom=2008&powerTo=160');
 const records=Array.isArray(filtered.body?.items)?filtered.body.items:[];
 result.steps.push({name:'power160',status:filtered.status,elapsedMs:filtered.elapsedMs,
  returnedRows:records.length,scanLimited:filtered.body?.scanLimited===true,
  hasMore:filtered.body?.hasMore===true,reads:filtered.body?.reads,
  stale:filtered.body?.stale===true,partial:filtered.body?.partial===true,
  filteredByPage:filtered.body?.filteredByPage===true,
  excessPower:records.filter(r=>Number.isFinite(r?.powerHp)&&r.powerHp>160).length});
 assert.equal(filtered.status,200,'filter_http');
 assert.equal(filtered.body?.ok,true,'filter_app');
 assert.equal(records.every(r=>r?.market==='japan'),true,'mixed_market');
 assert.equal(records.some(r=>Number.isFinite(r?.powerHp)&&r.powerHp>160),false,'wrong_power');
 result.status='verified';
}catch(e){
 result.status='not_confirmed';
 result.errorCode=typeof e?.message==='string'&&/^[a-z_]+$/.test(e.message)?e.message:'unverified';
 process.exitCode=1;
}
console.log(JSON.stringify(result));
