import test from 'node:test';
import assert from 'node:assert/strict';
import {getJsonStorage,resetJsonStorageForTests} from '../apps/web/lib/data';
import {availableShowcase} from '../apps/web/lib/dealers/program-store';
import {EMPTY_MEMBERSHIP} from '../apps/web/lib/dealers/program-model';
import {defaultShowcase} from '../apps/web/lib/dealers/showcase-model';

test('platform showcase avoids irrelevant membership I/O while external access stays fail-closed',async()=>{
 const driver=process.env.JSON_STORAGE_DRIVER;
 process.env.JSON_STORAGE_DRIVER='local';
 resetJsonStorageForTests();
 const storage=getJsonStorage(),originalRead=storage.readJsonWithMeta;
 const reads:string[]=[];
 let membership:unknown=new Error('membership_unavailable');
 const dealers=[
  {id:'dealer_topavto',name:'TopAvto',status:'verified'},
  {id:'external',name:'External',status:'verified'},
  {id:'pending',name:'Pending',status:'pending'},
  {id:'dealer_topavto_external',name:'Other',status:'verified'},
 ];
 storage.readJsonWithMeta=(async(relativePath:string,fallback:unknown)=>{
  reads.push(relativePath);
  if(relativePath==='dealers/dealers.json')return {value:dealers,found:true};
  if(relativePath.startsWith('dealers/memberships/')){
   if(membership instanceof Error)throw membership;
   return {value:membership,found:true};
  }
  throw Error(`unexpected_storage_read:${relativePath}`);
 }) as typeof storage.readJsonWithMeta;
 try{
  const platform=defaultShowcase('dealer_topavto');
  assert.strictEqual(await availableShowcase(platform),platform);
  assert.deepEqual(reads,['dealers/dealers.json']);

  for(const id of ['external','dealer_topavto_external']){
   reads.length=0;
   await assert.rejects(availableShowcase({...defaultShowcase(id),profileEnabled:true}),/membership_unavailable/);
   assert.ok(reads.includes(`dealers/memberships/${id}.json`));
  }

  const external={...defaultShowcase('external'),profileEnabled:true,stockEnabled:true,logoLight:'/logo.svg'};
  membership={...EMPTY_MEMBERSHIP,paidUntil:'2999-01-01T00:00:00Z'};
  assert.strictEqual(await availableShowcase(external),external);
  membership={...EMPTY_MEMBERSHIP};
  const expired=await availableShowcase(external);
  assert.equal(expired.profileEnabled,false);
  assert.equal(expired.stockEnabled,false);
  assert.equal(expired.logoLight,'');
  assert.equal(external.profileEnabled,true);
  assert.equal(external.stockEnabled,true);

  membership=new Error('membership_unavailable');
  for(const id of ['pending','unknown']){
   reads.length=0;
   const hidden=await availableShowcase({...defaultShowcase(id),profileEnabled:true,stockEnabled:true});
   assert.equal(hidden.profileEnabled,false);
   assert.equal(hidden.stockEnabled,false);
   assert.equal(reads.some(key=>key.startsWith('dealers/memberships/')),false);
  }
 }finally{
  storage.readJsonWithMeta=originalRead;
  resetJsonStorageForTests();
  if(driver===undefined)delete process.env.JSON_STORAGE_DRIVER;else process.env.JSON_STORAGE_DRIVER=driver;
 }
});
