const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const prior = Module._load;
const reads = [];
let china;
let sourceCalls = 0;
Module._load = function(id, parent, ...rest) {
 const local = parent?.filename.endsWith('/published-model-directory.ts');
 if (local && id === './green-corner') return {readGreenCorner:async()=>({items:[]})};
 if (local && id === './prepared-china-http-fixture') return {
  readPreparedChinaHomeCards:async(limit, options)=>{
   assert.equal(limit, 0);
   assert.deepEqual(options, {navigation:true});
   return china;
  }
 };
 if (local && id === './storage') return {
  catalogMakeFilterValues:make=>make.split(',').map(x=>x.trim()).filter(Boolean),
  readCatalogModelNames:async(make, market)=>{
   reads.push(market);
   return market === 'china' ? [{make:'Kia',model:'Old China'}] : [{make:'Kia',model:'Morning'}];
  }
 };
 if (id === '@/lib/catalog/ajes-catalog') return {readAjesDirectory:async()=>{
  sourceCalls++;
  return {models:[{make:'Toyota',model:'Aqua',total:4}],stale:false};
 }};
 return prior.call(this, id, parent, ...rest);
};
let published, source;
try {
 ({publishedModelSuggestions:published}=require('../apps/web/lib/catalog/published-model-directory.ts'));
 ({GET:source}=require('../apps/web/app/api/catalog/source-models/route.ts'));
} finally {
 Module._load=prior;
}
test('active China uses its sealed names while Korea reads only the published summary', async () => {
 china={facets:{models:[{make:'Kia',model:'K3'},{make:'BYD',model:'Dolphin'}]}};
 reads.length=0;
 const rows=await published('Kia','china|korea');
 assert.deepEqual(reads,['korea']);
 assert.deepEqual(rows.models.map(([,m])=>m),['K3','Morning']);
 for(const [market,model] of [['china','K3'],['korea','Morning'],['japan','Aqua']]){
  const response=await source(new Request('https://example.invalid/api/catalog/source-models?make=Kia&market='+market));
  assert.equal(response.status,200);
  assert.equal((await response.json()).models[0][1],model);
 }
 assert.equal(sourceCalls,1);
 china=null;
 assert.equal((await published('Kia','china')).models[0][1],'Old China');
});
