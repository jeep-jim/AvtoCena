import test from 'node:test';
import assert from 'node:assert/strict';
import {createMarketGenerationReader} from '../scripts/catalog-next/market-generation-reader.mjs';
const d='2026-11-24T10:24:33Z';
const ref=(market,id)=>({market,generationId:'gen_'+market+'_'+id,manifestSha256:'a'.repeat(64),
  pricingContextSha256:'b'.repeat(64),sourceObservedAt:d,pricingAsOf:d,rowCount:1,
  sourceMode:market==='japan'?'permitted-cache':'verified-full'});
const pointer=(market,active,revision=1)=>({kind:'market-data-pointer-v1',version:1,market,
  revision,active,previous:null,changedAt:d});
function makeStore(){const records=new Map();return {records,async read(market){
  return {etag:'"'+market+'"',value:records.get(market)||null};}}}

test('same accepted generation is opened once, no Docker or global operation',async()=>{
  const store=makeStore(),opened=[],closed=[],a=ref('china','a');
  store.records.set('china',pointer('china',a));
  const runtime=createMarketGenerationReader({store,refreshMs:0,openGeneration:async({market,reference})=>{
    opened.push([market,reference.generationId]);return {read:()=>reference.generationId,close:()=>closed.push(reference.generationId)};}});
  assert.equal(await runtime.withMarket('china',async({reader})=>reader.read()),'gen_china_a');
  assert.equal(await runtime.withMarket('china',async({reader})=>reader.read()),'gen_china_a');
  assert.deepEqual(opened,[['china','gen_china_a']]);assert.deepEqual(closed,[]);
});
test('new China generation is visible without closing a running request',async()=>{
  const store=makeStore(),closed=[],opened=[],a=ref('china','a'),b=ref('china','b');
  store.records.set('china',pointer('china',a));
  const runtime=createMarketGenerationReader({store,refreshMs:0,openGeneration:async({reference})=>{
    opened.push(reference.generationId);return {read:()=>reference.generationId,close:()=>closed.push(reference.generationId)};}});
  let release;const hold=new Promise(resolve=>release=resolve);let entered;
  const enteredPromise=new Promise(resolve=>entered=resolve);
  const first=runtime.withMarket('china',async({reader})=>{
    entered();await hold;return reader.read();
  });
  await enteredPromise;
  store.records.set('china',pointer('china',b,2));
  assert.equal(await runtime.withMarket('china',async({reader})=>reader.read()),'gen_china_b');
  assert.deepEqual(closed,[],'old handle cannot close while first request is active');
  release();
  assert.equal(await first,'gen_china_a');
  assert.deepEqual(closed,['gen_china_a']);
  assert.deepEqual(opened,['gen_china_a','gen_china_b']);
});
test('switching China does not re-open or alter Korea',async()=>{
  const store=makeStore(),opened=[],ch=ref('china','a'),ko=ref('korea','a');
  store.records.set('china',pointer('china',ch));store.records.set('korea',pointer('korea',ko));
  const runtime=createMarketGenerationReader({store,refreshMs:0,openGeneration:async({reference})=>{
    opened.push(reference.generationId);return {read:()=>reference.generationId,close:async()=>{}};}});
  await runtime.withMarket('china',async({reader})=>reader.read());
  await runtime.withMarket('korea',async({reader})=>reader.read());
  store.records.set('china',pointer('china',ref('china','b'),2));
  await runtime.withMarket('china',async({reader})=>reader.read());
  await runtime.withMarket('korea',async({reader})=>reader.read());
  assert.deepEqual(opened,['gen_china_a','gen_korea_a','gen_china_b']);
});
test('missing accepted pointer never serves guessed or unverified data',async()=>{
  const store=makeStore();
  const runtime=createMarketGenerationReader({store,openGeneration:async()=>({close:async()=>{}})});
  await assert.rejects(runtime.withMarket('china',async()=>{}),/pointer_absent/);
  await assert.rejects(runtime.withMarket('../china',async()=>{}),/request/);
});
test('failed opening replacement preserves former handle for recovery',async()=>{
  const store=makeStore(),closed=[],a=ref('china','a'),b=ref('china','b');
  store.records.set('china',pointer('china',a));
  const runtime=createMarketGenerationReader({store,refreshMs:0,openGeneration:async({reference})=>{
    if(reference.generationId===b.generationId)throw Error('bad index');
    return {read:()=>reference.generationId,close:()=>closed.push(reference.generationId)};
  }});
  await runtime.withMarket('china',async({reader})=>reader.read());
  store.records.set('china',pointer('china',b,2));
  await assert.rejects(runtime.withMarket('china',async()=>{}),/bad index/);
  assert.deepEqual(closed,[],'old handle is retained; no silent bad replacement');
  store.records.set('china',pointer('china',a,3));
  assert.equal(await runtime.withMarket('china',async({reader})=>reader.read()),a.generationId);
});
