import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {sha} from './chain.mjs';
import {compactPrior,checkPlan,planStream,TOTAL_LIMIT} from './private-plan.mjs';
const r={id:'b'.repeat(24),market:'uae',sourceId:'dubicars_uae_exact',sourceOfferId:'1234',calculationStatus:'needs_data',
  sourcePrice:14000,sourceCurrency:'AED',sellerPriceRub:310000,catalogPricingMode:'seller',totalRub:null,
  images:[{url:'https://www.dubicars.com/images/exact.jpg'}],operational:{raw:{metadata:'x'.repeat(8000000)}}};
test('compact predecessor never duplicates native body, preserves exact ref/row/price/gallery data binding',()=>{
 const result=compactPrior(r,'catalog/generations/exact/offers/uae/chunk-0001.json',2,{deliveredRub:()=>0,seller:()=>true});
 assert.ok(Buffer.byteLength(JSON.stringify(result))<800);
 assert.equal(result.ordinal,2);assert.equal(result.pricing.sellerRub,310000);
 assert.equal(result.pricing.exactInlineDeliveredRub,null);assert.equal(result.photoCount,1);
 assert.equal(result.rowSha256,sha(JSON.stringify(r)));assert.ok(!('images' in result)&&!('operational' in result));
});
test('preflight actually adapts UTF-8 NDJSON sharding and verifies complete block plan before writes',async()=>{
 const p=await fs.mkdtemp(path.join(os.tmpdir(),'uae-local-plan-'));
 try {
  const rows=Array.from({length:7},(_,i)=>({i,value:'ц'.repeat(40)}));
  const s=await planStream(p,'source-input',rows,{rowLimit:5,blockLimit:200});
  assert.equal(s.count,7);assert.equal(s.chunks.length,4);
  for(const x of s.chunks){
   const b=await fs.readFile(path.join(p,x.key));assert.equal(x.bytes,b.length);assert.ok(b.length<=200);assert.equal(x.sha256,sha(b));
  }
  const rest=await Promise.all(['predecessor-evidence','dispositions','source-holds'].map(k=>planStream(p,k,[])));
  assert.ok(checkPlan([s,...rest],1024).withinLimit);
  const tooLarge=structuredClone([s,...rest]);
  const forged=Array.from({length:100},(_,i)=>({key:'source-input/chunk-'+String(i).padStart(4,'0')+'.ndjson',rows:1,bytes:4*1024*1024,sha256:'a'.repeat(64)}));
  tooLarge[0]={...s,count:100,bytes:400*1024*1024,chunks:forged};
  const result=checkPlan(tooLarge,1024);assert.ok(result.bytes>TOTAL_LIMIT);assert.equal(result.withinLimit,false);
 } finally {await fs.rm(p,{recursive:true});}
});
