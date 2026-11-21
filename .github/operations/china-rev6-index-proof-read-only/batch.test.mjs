import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {buildExactFilterBatch,buildMakeIndex,takeExactMakeIndex} from './prepared-exact-filter-index.mjs';
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex'),H='a'.repeat(64);
const rows=Array.from({length:73},(_,i)=>({id:i.toString(16).padStart(24,'0'),market:'china',make:i%2?'Toyota':'Haval',
 model:i%2?'RAV4':'Jolion',year:2020+i%6,totalRub:100+2*i}));
const h=createHash('sha256').update('prepared-ordered-admitted-ids-v1\n');
for(const r of rows)h.update(JSON.stringify(r.id)+'\n');
const now=Date.parse('2026-11-21T08:00:00Z');
const active={generationId:'gen_1795239842026_china44871616387',admittedRows:rows.length,sameCutAdmittedOrderSha256:h.digest('hex'),
 directorySha256:H,editorialSha256:H,runtimeSourceSha256:H,pricingReceiptSha256:H,tariffVersionSha256:H,policyDay:'2026-11-21',validUntil:now+6000};
const queries=[{market:'china',make:'Haval'},{market:'china',make:'Toyota'},{market:'china',make:'Haval',model:'Jolion',yearFrom:2022,yearTo:2024,sort:'totalRub'},
 {market:'china',make:'Toyota',model:'RAV4',yearFrom:2022,yearTo:2024,sort:'totalRub'}];
let scans=0;
const opt={active,queries,clock:()=>now,async assertCurrent(){},async installedMembership(q){return r=>r.make===q.make&&(!q.model||r.model===q.model)&&r.year>=(q.yearFrom??0)&&r.year<=(q.yearTo??9999);},
 installedSelector(q,depth){const selected=[];return {add:r=>selected.push(r),finish:()=>selected.sort((a,b)=>q.sort==='totalRub'?a.totalRub-b.totalRub:b.totalRub-a.totalRub).slice(0,depth)};},
 async *verifiedRows(){scans++;for(const [offset,row]of rows.entries())yield {row,position:{id:row.id,chunk:0,part:0,offset,baseRub:row.totalRub}};}};
test('one physical stream, four byte-identical independent native query indexes, zero reads to count',async()=>{
 const batch=await buildExactFilterBatch({...opt,verifyFirstSix:true});assert.equal(scans,1);
 for(const [i,query] of queries.entries()){
  assert.deepEqual(batch[i],await buildMakeIndex({...opt,query}));
  const got=await takeExactMakeIndex({...opt,query,index:batch[i],expectedObjectSha256:digest(batch[i]),countOnly:true,
   readPosition(){assert.fail('count reads nothing');}});
  assert.equal(got.total,batch[i].total);
 }
});
test('fails on duplicate, cut drift, wrong admitted coverage or expiry',async()=>{
 await assert.rejects(buildExactFilterBatch({...opt,queries:[queries[0],queries[0]]}),/duplicate_exact_query/);
 let c=0;
 await assert.rejects(buildExactFilterBatch({...opt,async assertCurrent(){if(++c===2)throw Error('scope drift');}}),/scope drift/);
 await assert.rejects(buildExactFilterBatch({...opt,active:{...active,sameCutAdmittedOrderSha256:H}}),/full_ready_coverage/);
 await assert.rejects(buildExactFilterBatch({...opt,clock:()=>now+7000}),/native_admission_window/);
});

test('independent shallow native selection must match full rank prefix',async()=>{
 await assert.rejects(buildExactFilterBatch({...opt,verifyFirstSix:true,installedSelector(q,depth){
  if(depth!==6)return opt.installedSelector(q,depth);
  return {add(){},finish(){return []}};
 }}),/first_six_native_parity/);
});
