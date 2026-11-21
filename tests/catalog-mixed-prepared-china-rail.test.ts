import test from 'node:test';
import assert from 'node:assert/strict';
import {readMarketSection} from '../apps/web/lib/catalog/market-section-result';
import {includeMixedChinaRailCount,readMixedPreparedChinaRail} from '../apps/web/lib/catalog/mixed-prepared-china-rail';
import type {CatalogSearchParams} from '../apps/web/lib/catalog/types';
const q={make:'Haval',model:'Jolion',yearFrom:2022,budgetTo:3_000_000,sort:'totalRub',city:'Уссурийск',page:19};
const scope={source:'',stock:'',cut:'exact-cut'};
const fallback={id:'china',total:0,items:[] as unknown[]};
test('mixed Haval uses natural first page and same exact China filters/cut; UAE already returned',async()=>{
 let reveal!:()=>void;
 const gate=new Promise<void>(done=>{reveal=done;});
 const china=readMarketSection(()=>readMixedPreparedChinaRail(async (params,options)=>{
  assert.deepEqual(params,{...q,market:'china',page:1,pageSize:6});
  assert.equal(options.countOnly,false);assert.equal(options.marketPage,false);assert.equal(options.includeFacets,false);
  assert.equal(options.expectedGeneration,'exact-cut');assert.equal(options.unsupported,false);
  await gate;
  return {total:8,items:Array.from({length:6},(_,n)=>({id:'china-'+n}))};
 },q,6,scope),fallback,()=>assert.fail('unexpected China failure'));
 const uae=await Promise.resolve({total:2,items:[{id:'uae-1'},{id:'uae-2'}]});
 assert.deepEqual(uae.items.map(r=>r.id),['uae-1','uae-2']);
 const marker=Symbol();
 assert.equal(await Promise.race([china,Promise.resolve(marker)]),marker);
 reveal();
 const resolved=await china;
 assert.deepEqual(includeMixedChinaRailCount({total:uae.total,countIncomplete:false},resolved),{total:10,countIncomplete:false});
 assert.equal(resolved.unavailable,undefined);
 assert.equal(resolved.items.length,6);
});
test('China deadline settles as unavailable, not a zero or fallback; late result ignored',async()=>{
 let aborted=false,late!:(v:{total:number;items:any[]})=>void,decoded=0;
 const errors:unknown[]=[];
 const hanging=new Promise<{total:number;items:any[]}>(resolve=>{late=resolve;});
 const finish=readMarketSection(()=>readMixedPreparedChinaRail(async (_params,{signal})=>{
  signal.addEventListener('abort',()=>{aborted=true;},{once:true});
  const result=await hanging;signal.throwIfAborted();
  decoded++;return result;
 },q,6,scope,20),fallback,error=>errors.push(error));
 const uae=await Promise.resolve({total:32});
 assert.equal(uae.total,32);
 const failed=await finish;
 assert.deepEqual(failed,{...fallback,unavailable:true});
 assert.deepEqual(includeMixedChinaRailCount({total:uae.total,countIncomplete:false},failed),{total:32,countIncomplete:true});
 assert.match(String(errors[0]),/catalog_mixed_china_deadline/);assert.equal(aborted,true);
 late({total:1,items:[{}]});await new Promise(resolve=>setImmediate(resolve));
 assert.equal(decoded,0);assert.equal(uae.total,32);
});
test('native null/invalid window unavailable; exact zero valid; stock and source are not rewritten',async()=>{
 await assert.rejects(readMixedPreparedChinaRail(async(params:CatalogSearchParams,opt)=>{
  assert.equal(params.make,'Haval');assert.equal(opt.unsupported,true);return null;
 },q,6,{...scope,source:'ajes'}),/catalog_mixed_china_unavailable/);
 await assert.rejects(readMixedPreparedChinaRail(async()=>({total:8,items:[{}]}),q,6,scope),/catalog_mixed_china_unavailable/);
 assert.deepEqual(await readMixedPreparedChinaRail(async()=>({total:0,items:[]}),q,6,scope),{total:0,items:[]});
});
