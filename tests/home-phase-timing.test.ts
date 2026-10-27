import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHomePhaseTiming} from '../apps/web/lib/catalog/home-phase-timing.ts';
test('home phase telemetry preserves values, errors, concurrency and privacy',async()=>{
 const old=process.env.CATALOG_HOME_PHASE_TIMING, log=console.info, rows: any[]=[];
 console.info=(...args:any[])=>{rows.push(args);};
 try{
  delete process.env.CATALOG_HOME_PHASE_TIMING;
  const disabled=createHomePhaseTiming();const result={privateValue:'secret'};
  assert.equal(await disabled.measure('snapshot',async()=>result),result);assert.equal(rows.length,0);
  process.env.CATALOG_HOME_PHASE_TIMING='1';
  const timing=createHomePhaseTiming();timing.setGeneration('gen_123_abc');
  let release:()=>void=()=>{};const pending=new Promise<void>(r=>{release=r;});
  const slow=timing.measure('counts',()=>pending);
  assert.equal(await timing.measure('catalogPricing',async()=>result),result);
  assert.equal(rows.length,1);release();await slow;
  const error=new Error('sensitive supplier URL');
  await assert.rejects(timing.measure('dealer',async()=>{throw error;}),e=>e===error);
  const parsed=rows.map(x=>JSON.parse(x[1]));assert.equal(new Set(parsed.map(x=>x.trace)).size,1);
  assert.deepEqual(parsed.map(x=>x.ok),[true,true,false]);
  assert(parsed.every(x=>x.ms>=0&&x.generation==='gen_123_abc'));
  assert(!JSON.stringify(rows).includes('secret'));assert(!JSON.stringify(rows).includes('sensitive'));
  const next=createHomePhaseTiming();next.setGeneration('private/path');
  await next.measure('green',async()=>null);const last=JSON.parse(rows.at(-1)[1]);
  assert.notEqual(last.trace,parsed[0].trace);assert.equal(last.generation,undefined);
  console.info=()=>{throw Error('logger broken');};
  assert.equal(await timing.measure('green',async()=>42),42);
  await assert.rejects(timing.measure('green',async()=>{throw error;}),e=>e===error);
 }finally{console.info=log;if(old===undefined)delete process.env.CATALOG_HOME_PHASE_TIMING;else process.env.CATALOG_HOME_PHASE_TIMING=old;}
});
