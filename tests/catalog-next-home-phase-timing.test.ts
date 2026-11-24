import test from 'node:test';
import assert from 'node:assert/strict';
import {createHomePhaseTiming} from '../apps/web/lib/catalog/home-phase-timing';

function fixture(t:any){
 const keys=['CATALOG_HOME_PHASE_TIMING','CATALOG_HOME_PHASE_TIMING_MAX_UPTIME_SECONDS'];
 const before=keys.map(key=>process.env[key]);
 t.after(()=>keys.forEach((key,i)=>{if(before[i]===undefined)delete process.env[key];else process.env[key]=before[i];}));
 const state={uptime:0,logs:[] as any[]};
 t.mock.method(process,'uptime',()=>state.uptime);
 t.mock.method(console,'info',(...args:any[])=>{state.logs.push(args);});
 process.env.CATALOG_HOME_PHASE_TIMING='1';
 delete process.env.CATALOG_HOME_PHASE_TIMING_MAX_UPTIME_SECONDS;
 return state;
}

test('home phase timing retains its existing flag behavior when the uptime limit is absent',async t=>{
 const state=fixture(t);state.uptime=1e9;
 const value={privateValue:'must not be logged'};
 assert.equal(await createHomePhaseTiming().measure('snapshot',async()=>value),value);
 assert.equal(state.logs.length,1);assert(!JSON.stringify(state.logs).includes(value.privateValue));
 for(const flag of [undefined,'0','true','2']){
  if(flag===undefined)delete process.env.CATALOG_HOME_PHASE_TIMING;else process.env.CATALOG_HOME_PHASE_TIMING=flag;
  assert.equal(await createHomePhaseTiming().measure('counts',async()=>value),value);
 }
 assert.equal(state.logs.length,1);
});

test('home phase timing evaluates the positive uptime limit below, at and above its boundary for every new trace',async t=>{
 const state=fixture(t);process.env.CATALOG_HOME_PHASE_TIMING_MAX_UPTIME_SECONDS='1800';
 for(const [uptime,expectedLogs] of [[0,1],[1799.999,2],[1800,2],[1800.001,2],[3600,2]]){
  state.uptime=uptime;
  assert.equal(await createHomePhaseTiming().measure('catalogPricing',async()=>123),123);
  assert.equal(state.logs.length,expectedLogs,`uptime ${uptime}`);
 }
 const rows=state.logs.map(args=>JSON.parse(args[1]));
 assert(rows.every(row=>row.phase==='catalogPricing'&&row.ok===true&&row.ms>=0));
 assert.notEqual(rows[0].trace,rows[1].trace);
});

test('an invalid explicit uptime limit disables timing without changing values or rejections',async t=>{
 const state=fixture(t),failure=Error('private failure');
 for(const limit of ['', ' ', '0', '-1', 'NaN', 'Infinity', '-Infinity', '1800s']){
  process.env.CATALOG_HOME_PHASE_TIMING_MAX_UPTIME_SECONDS=limit;
  const timing=createHomePhaseTiming();
  assert.equal(await timing.measure('green',async()=>42),42);
  await assert.rejects(timing.measure('counts',async()=>{throw failure;}),error=>error===failure);
 }
 assert.deepEqual(state.logs,[]);
 process.env.CATALOG_HOME_PHASE_TIMING_MAX_UPTIME_SECONDS='0.5';state.uptime=0.49;
 await createHomePhaseTiming().measure('green',async()=>42);
 state.uptime=0.5;await createHomePhaseTiming().measure('green',async()=>42);
 assert.equal(state.logs.length,1,'positive finite fractional limits use the same boundary');
});

test('the uptime limit does not enable an unset flag or interrupt a trace already in progress',async t=>{
 const state=fixture(t);process.env.CATALOG_HOME_PHASE_TIMING_MAX_UPTIME_SECONDS='1800';
 delete process.env.CATALOG_HOME_PHASE_TIMING;
 await createHomePhaseTiming().measure('snapshot',async()=>42);assert.equal(state.logs.length,0);
 process.env.CATALOG_HOME_PHASE_TIMING='1';state.uptime=1799;
 const timing=createHomePhaseTiming();
 let release!:(value:number)=>void;
 const value=new Promise<number>(resolve=>{release=resolve;});
 const pending=timing.measure('snapshot',()=>value);
 state.uptime=1800;
 await createHomePhaseTiming().measure('green',async()=>42);assert.equal(state.logs.length,0);
 release(123);assert.equal(await pending,123);
 assert.equal(state.logs.length,1);assert.equal(JSON.parse(state.logs[0][1]).phase,'snapshot');
 const failure=Error('expired trace failure');
 await assert.rejects(createHomePhaseTiming().measure('dealer',async()=>{throw failure;}),error=>error===failure);
 assert.equal(state.logs.length,1);
});
