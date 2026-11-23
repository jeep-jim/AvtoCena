// Runs against the production build on a loopback-only listener.
import assert from 'node:assert/strict';
const expectedGeneration='gen_1795239842026_china44871616387';
const expectedCount=64605;
const pageIds=new Set();
for(const [name,params] of [
  ['cold-count','source=existing&countOnly=1'],
  ['saved-page-1','source=existing&marketPage=1&page=1'],
  ['saved-page-2','source=existing&marketPage=1&page=2'],
  ['warm-count','countOnly=1'],
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
  for(const row of result.items){
    assert.equal(row.market,'china');assert.equal(row.preparedChinaSelection?.generationId,result.generationId);
    assert(typeof row.id==='string' && row.id.length>0 && !pageIds.has(row.id));pageIds.add(row.id);
  }
}
assert.equal(pageIds.size,48);
