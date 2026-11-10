import test from 'node:test';
import assert from 'node:assert/strict';
import {createRelatedOffersScheduler} from '../apps/web/lib/catalog/related-offers-scheduler';

test('secondary admission is two active operations and sixteen waiters, with no visitor result reuse',async()=>{
  const run=createRelatedOffersScheduler();
  let release!:()=>void,started=0,active=0,peak=0;
  const held=new Promise<void>(resolve=>{release=resolve;});
  const operation=async()=>{const id=++started;active++;peak=Math.max(peak,active);await held;active--;return id;};
  const accepted=Array.from({length:18},()=>run(operation));
  assert.equal(started,2);
  try{await assert.rejects(run(operation),/detail_cache_queue_full/);}
  finally{release();}
  const values=await Promise.all(accepted);
  assert.equal(peak,2);assert.equal(started,18);assert.equal(new Set(values).size,18);
  assert.equal(await run(operation),19,'same callable is executed again, never a stored or cross-visitor result');
});

test('a waiting secondary operation expires after five seconds and is never executed later',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const run=createRelatedOffersScheduler();
  let release!:()=>void,queuedStarted=false;
  const held=new Promise<void>(resolve=>{release=resolve;});
  const active=[run(()=>held),run(()=>held)];
  const waiting=run(async()=>{queuedStarted=true;});
  const rejected=assert.rejects(waiting,/detail_cache_queue_timeout/);
  t.mock.timers.tick(4_999);assert.equal(queuedStarted,false);
  t.mock.timers.tick(1);await rejected;
  release();await Promise.all(active);
  assert.equal(queuedStarted,false);
  assert.equal(await run(async()=>42),42,'expired waiting work does not consume the next slot');
});

test('request orchestration releases each operation before scheduling its next stage',async()=>{
  const run=createRelatedOffersScheduler();
  const events:string[]=[];
  // The request itself never holds an admission slot around nested work.
  const request=async(id:string)=>{
    await run(async()=>{events.push(id+'-detail');});
    const reads=await Promise.all([run(async()=>id+'-model'),run(async()=>id+'-market')]);
    return run(async()=>{events.push(id+'-price');return reads;});
  };
  let timeout:ReturnType<typeof setTimeout>|undefined;
  try{
    const result=await Promise.race([Promise.all([request('a'),request('b')]),new Promise<never>((_,reject)=>{timeout=setTimeout(()=>reject(Error('secondary pipeline deadlock')),250);})]);
    assert.deepEqual(result,[['a-model','a-market'],['b-model','b-market']]);
    assert.equal(events.length,4);
  }finally{if(timeout)clearTimeout(timeout);}
});
