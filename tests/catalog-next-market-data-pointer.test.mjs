import test from 'node:test';
import assert from 'node:assert/strict';
import {activateMarketGeneration,validateMarketGeneration,marketPointerPath,MARKET_IDS} from '../scripts/catalog-next/market-data-pointer.mjs';

const d='2026-11-24T10:24:33.000Z',s='2026-11-24T10:22:41.000Z';
const digest=n=>n.repeat(64);
const generation=(market,id,sourceMode=market==='japan'?'permitted-cache':'verified-full')=>({
  market,generationId:'gen_'+market+'_'+id,manifestSha256:digest('a'),
  pricingContextSha256:digest('b'),sourceObservedAt:s,pricingAsOf:d,rowCount:283188,sourceMode
});
function memoryStorage(){
  const map=new Map(),writes=[];
  return {writes,map,async read(market){const r=map.get(market);return r?structuredClone(r):{etag:null,value:null}},
    async compareAndSwap(market,etag,document){
      const before=map.get(market);
      if((before?.etag??null)!==etag)throw Error('conflict');
      const next={etag:'"'+market+'-'+(Number(before?.value?.revision??0)+1)+'"',value:structuredClone(document)};
      map.set(market,next);writes.push({market,document:next.value});
    }};
}
const accept=({generation:g})=>({verified:true,manifestSha256:g.manifestSha256});
const read=({generation:g})=>({verified:true,generationId:g.generationId});
const base={verifyPrepared:accept,verifyReading:read,now:()=>d};

test('each market gets an independent deterministic pointer key',()=>{
  assert.equal(new Set(MARKET_IDS.map(marketPointerPath)).size,MARKET_IDS.length);
  for(const market of MARKET_IDS)assert.equal(marketPointerPath(market),'catalog/markets/'+market+'/accepted-pointer-v1.json');
});
test('Japan cannot be mirrored; other markets cannot inherit AJ cache rules',()=>{
  assert.throws(()=>validateMarketGeneration('japan',generation('japan','1','verified-full')),/source_permission/);
  assert.throws(()=>validateMarketGeneration('china',generation('china','1','permitted-cache')),/source_permission/);
  assert.ok(validateMarketGeneration('japan',generation('japan','1','permitted-cache')));
});
test('switching China never modifies Korea or any other pointer',async()=>{
  const storage=memoryStorage();
  const ko=await activateMarketGeneration({...base,storage,market:'korea',generation:generation('korea','a')});
  const ch=await activateMarketGeneration({...base,storage,market:'china',generation:generation('china','a')});
  assert.equal(ko.status,'activated');assert.equal(ch.status,'activated');
  assert.equal(storage.writes.length,2);
  assert.deepEqual(storage.writes.map(x=>x.market),['korea','china']);
  const prior=structuredClone((await storage.read('korea')).value);
  await activateMarketGeneration({...base,storage,market:'china',generation:generation('china','b')});
  assert.deepEqual((await storage.read('korea')).value,prior);
  assert.equal((await storage.read('china')).value.revision,2);
  assert.equal((await storage.read('china')).value.previous.generationId,'gen_china_a');
});
test('no write if preparation fails, and one accepted generation is idempotent',async()=>{
  const storage=memoryStorage(),g=generation('china','a');
  await assert.rejects(activateMarketGeneration({...base,storage,market:'china',generation:g,
    verifyPrepared:async()=>({verified:false,manifestSha256:g.manifestSha256})}),/unverified_prepared/);
  assert.equal(storage.writes.length,0);
  await activateMarketGeneration({...base,storage,market:'china',generation:g});
  assert.equal((await activateMarketGeneration({...base,storage,market:'china',generation:g})).status,'already-active');
  assert.equal(storage.writes.length,1);
  await assert.rejects(activateMarketGeneration({...base,storage,market:'china',
    generation:{...g,manifestSha256:digest('c')}}),/generation_reused_with_different_content/);
});
test('reader mismatch rolls back only the target market pointer',async()=>{
  const storage=memoryStorage();
  await activateMarketGeneration({...base,storage,market:'china',generation:generation('china','a')});
  await activateMarketGeneration({...base,storage,market:'korea',generation:generation('korea','a')});
  await assert.rejects(activateMarketGeneration({...base,storage,market:'china',generation:generation('china','b'),
    verifyReading:async()=>({verified:false,generationId:'gen_china_b'})}),/postcheck_failed_rolled_back/);
  assert.equal((await storage.read('china')).value.active.generationId,'gen_china_a');
  assert.equal((await storage.read('china')).value.revision,3);
  assert.equal((await storage.read('korea')).value.revision,1);
});
test('stale CAS cannot overwrite another same-market writer',async()=>{
  const storage=memoryStorage(),g1=generation('china','a'),g2=generation('china','b');
  let unblock;
  const hold=new Promise(resolve=>unblock=resolve);
  const first=activateMarketGeneration({...base,storage,market:'china',generation:g1,
    verifyPrepared:async()=>{await hold;return accept({generation:g1})}});
  const second=await activateMarketGeneration({...base,storage,market:'china',generation:g2});
  unblock();
  await assert.rejects(first,/cas_rejected_or_unknown/);
  assert.equal(second.status,'activated');
  assert.equal((await storage.read('china')).value.active.generationId,'gen_china_b');
});
test('lost PUT acknowledgement is resolved by exact readback, not a new write',async()=>{
  const storage=memoryStorage(),cas=storage.compareAndSwap.bind(storage);
  storage.compareAndSwap=async(...args)=>{await cas(...args);throw Error('lost transport response')};
  const result=await activateMarketGeneration({...base,storage,market:'uae',generation:generation('uae','a')});
  assert.equal(result.status,'activated');
  assert.equal(storage.writes.length,1);
});
test('a failed postcheck must not roll back a newer accepted market',async()=>{
  const storage=memoryStorage();
  await activateMarketGeneration({...base,storage,market:'china',generation:generation('china','a')});
  await assert.rejects(activateMarketGeneration({...base,storage,market:'china',generation:generation('china','b'),
    verifyReading:async()=>{
      const observed=await storage.read('china');
      await storage.compareAndSwap('china',observed.etag,{...observed.value,revision:observed.value.revision+1,
        active:generation('china','c'),previous:observed.value.active});
      return {verified:false,generationId:'gen_china_b'};
    }}),/postcheck_failed_state_changed/);
  assert.equal((await storage.read('china')).value.active.generationId,'gen_china_c');
});
