import assert from 'node:assert/strict';

// User-facing acceptance of AJ on the currently accepted runtime. Three
// bounded requests from the runner's real IP; no direct vendor calls or dump.
const origin='https://avtocena.com';
const report={kind:'japan-public-acceptance-v1',market:'japan',providerDumpRequests:0,
  visitorIpSpoofed:false,steps:[]};
const step=async(path,{html=false}={})=>{
  const started=Date.now();
  const response=await fetch(origin+path,{redirect:'error',cache:'no-store',
    headers:{Accept:html?'text/html':'application/json'},signal:AbortSignal.timeout(28000)});
  const max=html?3*1024*1024:1024*1024;
  let count=0;const chunks=[];
  for await(const part of response.body??[]){
    count+=part.byteLength;if(count>max)throw Error('response_too_large');
    chunks.push(Buffer.from(part));
  }
  const text=Buffer.concat(chunks).toString('utf8');
  return {httpStatus:response.status,elapsedMs:Date.now()-started,
    body:html?text:JSON.parse(text)};
};
try{
  const filtered=await step('/api/catalog/search?market=japan&yearFrom=2008&powerTo=160&page=1&pageSize=3');
  const items=Array.isArray(filtered.body?.items)?filtered.body.items:[];
  const wronglyPowered=items.filter(v=>Number.isFinite(Number(v.powerHp))&&Number(v.powerHp)>160);
  report.steps.push({name:'powerTo160',httpStatus:filtered.httpStatus,elapsedMs:filtered.elapsedMs,
    items:items.length,japanItems:items.filter(v=>v?.market==='japan').length,
    excessPower:wronglyPowered.length,
    countIncomplete:filtered.body?.countIncomplete===true,stale:filtered.body?.stale===true});
  assert.equal(filtered.httpStatus,200,'filtered_http');
  assert.equal(filtered.body?.ok,true,'filtered_app');
  assert.equal(wronglyPowered.length,0,'excess_power');
  assert.equal(items.length,items.filter(v=>v?.market==='japan').length,'mixed_market');
  const page=await step('/cars/japan',{html:true});
  report.steps.push({name:'japanMarketPage',httpStatus:page.httpStatus,elapsedMs:page.elapsedMs,
    catalogHeading:page.body.includes('Каталог автомобилей'),japanNamed:page.body.includes('Япония')});
  assert.equal(page.httpStatus,200,'page_http');
  assert.equal(page.body.includes('Каталог автомобилей'),true,'page_heading');
  assert.equal(page.body.includes('Япония'),true,'page_market');
  const candidate=items.find(v=>typeof v?.id==='string'&&/^ajes-(?:stats|main)-[a-zA-Z0-9_-]{1,64}$/.test(v.id));
  if(candidate) {
    const detail=await step('/cars/offer/'+encodeURIComponent(candidate.id),{html:true});
    report.steps.push({name:'offerDetail',httpStatus:detail.httpStatus,elapsedMs:detail.elapsedMs,
      hasRubles:detail.body.includes('₽'),hasVehicleContent:detail.body.includes('Япония')});
    assert.equal(detail.httpStatus,200,'detail_http');
    assert.equal(detail.body.includes('₽'),true,'detail_price');
  }else report.steps.push({name:'offerDetail',result:'not_checked_no_eligible_ajes_offer'});
  report.status='accepted_public_path';
}catch(error) {
  report.status='not_confirmed';
  report.failureCode=typeof error?.message==='string'&&/^[a-z_]+$/.test(error.message)
    ?error.message:'verification_failed';
  process.exitCode=1;
}
console.log(JSON.stringify(report));
