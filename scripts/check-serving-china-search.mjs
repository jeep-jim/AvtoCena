// Runs against the production build on a loopback-only listener.
import assert from 'node:assert/strict';
const expectedGeneration='gen_1795239842026_china44871616387';
const expectedCount=64605;
const pageIds=new Set();
let firstPageIds;
for(const [name,params] of [
  ['cold-count','source=existing&countOnly=1'],
  ['saved-page-1','source=existing&marketPage=1&page=1'],
  ['saved-page-2','source=existing&marketPage=1&page=2'],
  ['warm-count','countOnly=1'],
  ['warm-page-1','source=existing&marketPage=1&page=1'],
]){
  const start=performance.now();
  const response=await fetch('http://127.0.0.1:3107/api/catalog/search?market=china&powerTo=160&'+params,{signal:AbortSignal.timeout(90_000)});
  const result=await response.json();
  console.log(JSON.stringify({name,status:response.status,generationId:result.generationId,total:result.total,
    items:result.items?.length,ms:Math.round(performance.now()-start),error:result.error}));
  assert.equal(response.status,200);
  assert.equal(result.generationId,expectedGeneration);
  assert.equal(result.total,expectedCount);
  if(params.includes('countOnly')){assert.equal(result.items.length,0);continue;}
  assert.equal(result.items.length,24);
  const ids=result.items.map(row=>row.id);
  if(name==='saved-page-1')firstPageIds=ids;
  if(name==='warm-page-1')assert.deepEqual(ids,firstPageIds);
  for(const row of result.items){
    assert.equal(row.market,'china');assert.equal(row.preparedChinaSelection?.generationId,result.generationId);
    assert(typeof row.id==='string' && row.id.length>0);
    if(name!=='warm-page-1'){assert(!pageIds.has(row.id));pageIds.add(row.id);}
  }
}
assert.equal(pageIds.size,48);

async function powerCount(market) {
  const url=new URL('http://127.0.0.1:3107/api/catalog/search?powerTo=160&countOnly=1');
  if(market)url.searchParams.set('market',market);
  const started=performance.now();
  const response=await fetch(url,{signal:AbortSignal.timeout(90_000)});
  assert.equal(response.status,200);
  const body=await response.json();
  assert.equal(body.ok,true);
  assert.deepEqual(body.items,[]);
  console.log(JSON.stringify({name:market?'direct-'+market:'combined',total:body.total,
    marketCounts:body.marketCounts,missingMarkets:body.missingMarkets,ms:Math.round(performance.now()-started)}));
  return body;
}
// Compare Korea and China with their individual counts and keep the unknown auction count explicit.
const korea=await powerCount('korea');
assert(Number.isSafeInteger(korea.total) && korea.total>0 && !korea.countIncomplete);
await powerCount();
const warm=await powerCount();
assert.equal(warm.countIncomplete,true);
assert(Array.isArray(warm.missingMarkets) && warm.missingMarkets.includes('japan'));
assert.equal(warm.marketCounts.china,expectedCount);
assert.equal(warm.marketCounts.korea,korea.total);
const known=Object.entries(warm.marketCounts);
assert(known.every(([market,count])=>!warm.missingMarkets.includes(market) && Number.isSafeInteger(count) && count>=0));
assert.equal(warm.total,known.reduce((sum,[,count])=>sum+count,0));
