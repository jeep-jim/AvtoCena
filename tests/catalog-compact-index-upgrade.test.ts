import test from 'node:test';
import assert from 'node:assert/strict';
import {getJsonStorage,StorageConflictError} from '../apps/web/lib/data';
import {backfillCatalogBudgetCountIndex,resetCatalogReadCachesForTests,countCatalogOffers} from '../apps/web/lib/catalog/storage';
test('compact schema upgrade appends v2 and verifies stored readiness without overwriting immutable v1',async(t)=>{
 const generationId='upgrade-test';
 const row:any={id:'suv',market:'korea',make:'Hyundai',model:'Tucson',year:2024,bodyType:'suv',totalRub:1500000,mileageKm:40000,engineCc:1598,powerHp:123,fuel:'petrol',powertrainKind:'combustion',transmission:'automatic',drive:'fwd',cardImageUrl:'https://example.com/car.jpg',cardProjectionVersion:3,publicVisibleRub:1500000,publicSpecificationVerified:true,calculationStatus:'ready',updatedAt:'2026-10-04T00:00:00Z'};
 const root=`catalog/generations/${generationId}/indexes/`;
 const old={version:1,generationId,sourceRows:1,rows:[]};
 const objects=new Map<string,any>([
  ['catalog/manifest.json',{generationId,markets:{korea:{count:1}}}],
  ['catalog/public/facets.json',{generationId}],
  ['catalog/public/projection/all.json',{generationId,items:[row]}],
  [root+'budget-count-v1.json',old],
  [root+'budget-cards-v1/0.json',{generationId,items:['old-card']}],
 ]);
 const reads:string[]=[],writes:string[]=[];
 const storage=getJsonStorage();resetCatalogReadCachesForTests();
 t.mock.method(storage,'readJsonWithMeta',async(key:string,fallback:any)=>{reads.push(key);return {found:objects.has(key),value:objects.has(key)?structuredClone(objects.get(key)):fallback};});
 t.mock.method(storage,'writeJson',async(key:string,value:any,options:any)=>{if(options?.ifNoneMatch==='*'&&objects.has(key))throw new StorageConflictError();writes.push(key);objects.set(key,structuredClone(value));});
 try{
  const result=await backfillCatalogBudgetCountIndex();
  assert.equal(result.verified,true);assert.equal(result.version,2);
  assert.deepEqual(objects.get(root+'budget-count-v1.json'),old);
  assert.deepEqual(objects.get(root+'budget-cards-v1/0.json').items,['old-card']);
  assert.equal(objects.get(root+'budget-count-v2.json').filterVersion,1);
  assert.deepEqual(objects.get(root+'budget-count-v2.json').otherRows,[]);
  assert.equal(objects.get(root+'budget-cards-v2/0.json').items[0].id,'suv');
  assert.ok(reads.includes(root+'budget-count-v2.json'),'success checks the actual persisted selector');
  assert.ok(writes.every(key=>!key.includes('budget-count-v1')&&!key.includes('budget-cards-v1')));
  assert.equal((await countCatalogOffers({bodyType:'suv'})).total,1);
 }finally{t.mock.restoreAll();resetCatalogReadCachesForTests();}
});
