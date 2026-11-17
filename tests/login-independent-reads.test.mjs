import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// Exercise the page's actual data block, including its downstream admission/price logic.
const source=readFileSync(new URL('../apps/web/app/(public)/login/page.tsx',import.meta.url),'utf8');
const block=source.slice(source.indexOf('  const featuresPromise ='),source.indexOf('\n  return ('));
assert.ok(block.includes('const stored = storedResult.value;'));
assert.ok(block.includes('if (storedResult.ok === false)'));
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const names=['readPublicFeatures','readShowcase','PILOT_DEALER_ID','availableShowcase','withDealerRate','publicDealerProfile','publicRail','findDealer'];
const runBlock=b=>new AsyncFunction(...names,b.replaceAll(' as const','')+'\nreturn {features,stored,dealer,topDealer};');
const run=runBlock(block);
const old=runBlock(block.replace(/  const featuresPromise =[\s\S]*?  const stored = storedResult.value;/,'  const features = await readPublicFeatures();\n  const stored = await readShowcase(PILOT_DEALER_ID);'));
const defer=()=>{let resolve,reject; const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject};};
const tick=()=>new Promise(r=>setImmediate(r));
const invoke=(f,s)=>run(f,s,'dealer_topavto',async x=>x,async x=>x,x=>x,()=>[],async()=>({status:'verified'}));

test('starts both independent reads before either resolves and preserves identities',async()=>{
 const f=defer(),s=defer(),calls=[];
 const result=invoke(()=>{calls.push('features');return f.promise},id=>{calls.push(id);return s.promise});
 assert.deepEqual(calls,['features','dealer_topavto']);
 const features={accountAppearance:{version:1}},stored={profileEnabled:false};
 s.resolve(stored);f.resolve(features);
 const value=await result;assert.equal(value.features,features);assert.equal(value.stored,stored);
});

test('old and new output and downstream calls match for all admission branches',async()=>{
 for(const stored of [null,{profileEnabled:false},{profileEnabled:true,deny:false},{profileEnabled:true,deny:true}]){
  const execute=async fn=>{const calls=[];const features={accountAppearance:{version:1}};
   const output=await fn(async()=>features,async()=>stored,'dealer_topavto',async s=>{calls.push('admission');return {...s,profileEnabled:!s.deny}},async s=>{calls.push('prices');return {...s,price:123}},s=>{calls.push('profile');return {enabled:s.profileEnabled}},s=>{calls.push('rail');return [{price:s.price}]},async()=>{calls.push('verification');return {status:'verified'}});
   return {output,calls};};
  assert.deepEqual(await execute(run),await execute(old));
 }
});

test('showcase error preserved after successful features',async()=>{
 const error=new Error('showcase');await assert.rejects(invoke(async()=>({}),async()=>{throw error}),e=>e===error);
});

test('features error takes precedence even when showcase rejects first',async()=>{
 const f=defer(),error=new Error('features');
 const result=invoke(()=>f.promise,async()=>{throw new Error('showcase')});
 const check=assert.rejects(result,e=>e===error);await tick();f.reject(error);await check;await tick();
});

test('features failure does not wait; late showcase rejection is handled',async()=>{
 const s=defer(),error=new Error('features');
 await assert.rejects(invoke(async()=>{throw error},()=>s.promise),e=>e===error);
 s.reject(new Error('late'));await tick();
});

test('synchronous feature error preserves old no-showcase behaviour',async()=>{
 let called=false;const error=new Error('features');
 await assert.rejects(invoke(()=>{throw error},async()=>{called=true}),e=>e===error);assert.equal(called,false);
});
