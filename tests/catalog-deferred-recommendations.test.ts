import test from 'node:test';
import assert from 'node:assert/strict';
import {createRecommendationsHandler} from '../apps/web/app/api/catalog/recommendations/handler';

const request=(query:string,signal?:AbortSignal)=>new Request('https://avtocena.com/api/catalog/recommendations?'+query,{signal});

test('background work is bounded, rejects overload without a queue, and releases slots after completion',async()=>{
  const completions:(()=>void)[]=[];let calls=0;
  const load=async()=>{calls++;await new Promise<void>(resolve=>completions.push(resolve));return {kind:'related'};};
  const get=createRecommendationsHandler({related:load,alternatives:load});
  const first=get(request('id=one')),second=get(request('id=two'));
  const busy=await get(request('id=three'));
  assert.equal(calls,2);assert.equal(busy.status,503);assert.equal(busy.headers.get('Retry-After'),'5');
  assert.deepEqual(await busy.json(),{error:'recommendations_busy'});
  completions.shift()!();assert.equal((await first).status,200);
  const third=get(request('id=three'));assert.equal(calls,3);
  completions.splice(0).forEach(resolve=>resolve());await Promise.all([second,third]);
});

test('aborting a visitor does not free the slot while its actual source work is still running',async()=>{
  let finish!:()=>void;
  const load=async()=>{await new Promise<void>(resolve=>finish=resolve);return {kind:'related'};};
  const get=createRecommendationsHandler({related:load,alternatives:load},1);
  const controller=new AbortController(),first=get(request('id=one',controller.signal));controller.abort();
  assert.equal((await get(request('id=two'))).status,503);
  finish();await first;
  assert.equal((await get(request('id=two',controller.signal))).status,408);
});

test('source exceptions release the slot and never expose supplier bodies, URLs or private context',async()=>{
  let calls=0;
  const load=async()=>{if(calls++===0)throw Error('https://supplier.invalid?code=private&ip=127.0.0.1');return {kind:'related'};};
  const get=createRecommendationsHandler({related:load,alternatives:load},1);
  const failed=await get(request('id=one'));
  assert.equal(failed.status,503);assert.deepEqual(await failed.json(),{error:'recommendations_unavailable'});
  assert.equal((await get(request('id=one'))).status,200);
});

test('invalid modes, IDs and markets never reach any source',async()=>{
  let calls=0;const load=async()=>{calls++;return {};};
  const get=createRecommendationsHandler({related:load,alternatives:load});
  for(const query of ['', 'kind=admin&id=one','id=..%2Fprivate','id=%3Cscript%3E','id='+('a'.repeat(201)),'id=one&markets=admin']){
    assert.equal((await get(request(query))).status,400,query);
  }
  assert.equal(calls,0);
});

test('requests remain private and independent; only ID and validated display markets reach loaders',async()=>{
  const seen:any[]=[];const load=async(query:any)=>{seen.push(query);return {kind:'related',request:seen.length};};
  const get=createRecommendationsHandler({related:load,alternatives:load});
  for(let i=0;i<2;i++){
    const response=await get(request('id=ajes-china-123&markets=china,japan,china&sourceId=private&ip=8.8.8.8&totalRub=1'));
    assert.equal(response.headers.get('Cache-Control'),'private, no-store');
    assert.equal((await response.json()).request,i+1);
  }
  assert.deepEqual(seen,[{id:'ajes-china-123',markets:['china','japan']},{id:'ajes-china-123',markets:['china','japan']}]);
});

test('unknown unavailable pages can request public alternatives without inventing vehicle identity',async()=>{
  const seen:any[]=[];const load=async(query:any)=>{seen.push(query);return {kind:'alternatives',items:[]};};
  const get=createRecommendationsHandler({related:async()=>{throw Error('wrong_loader');},alternatives:load});
  const response=await get(request('kind=alternatives'));
  assert.equal(response.status,200);assert.deepEqual(seen,[{id:'',markets:undefined}]);
});
