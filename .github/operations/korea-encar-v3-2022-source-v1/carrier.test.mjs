import test from 'node:test';
import assert from 'node:assert/strict';
import {authorized,providerTransport,runPhase,predecessorFromReceipt,rootFor} from './carrier.mjs';
const start=Date.parse('2026-11-21T07:00:00.000Z'), tree='a'.repeat(40);
const auth=authorized({version:1,scope:'encar_v3_2022_for_sale_source_only',noNewPurchase:true,inExistingPaidScopeVerified:true,
 authorityEvidenceSha256:'b'.repeat(64),privatePrefixApprovalSha256:'c'.repeat(64),workerTree:tree,programMaxHttpAttempts:6,anchorDate:'2026-11-21',
 checkedAt:new Date(start).toISOString(),expiresAt:new Date(start+7200000).toISOString()},tree,start);
const root='catalog/operations/korea-encar-scoped-source/v1/123456789/attempt-1';
const identity={runId:'123456789',attempt:'1',revision:'d'.repeat(40)};
function store(){
 const m=new Map();return {m,readJson:async(k,alt)=>m.has(k)?structuredClone(m.get(k)):alt,
   writeJson:async(k,v,o)=>{assert.deepEqual(o,{ifNoneMatch:'*'});assert.ok(k.startsWith(root+'/'));assert.ok(!m.has(k));m.set(k,structuredClone(v));}};
}
const wire=x=>Buffer.from(JSON.stringify(x)).toString('base64');
function setup(){
 let time=start;return {root,auth,identity,phase:'initial',storage:store(),checkOwner:async()=>{},clock:()=>time,
 deadline:start+91000, tick:()=>time+=31000};
}
const row={inner_id:'1234567',year:2022,model_year:2022,advertisement_type:'Sale',sales_status:'Available',is_duplicate:false};
test('append-only s3 mock + checkpoint + exact continued page with no rewind',async()=>{
 const a=setup(), seen=[];
 const source=async r=>{seen.push(r);a.tick();return r.endpoint==='change_id'?wire({change_id:970}):
 wire({result:[{...row,inner_id:String(1234570+r.params.page)}],meta:{page:r.params.page,next_page:r.params.page===1?2:null}});};
 const p=await runPhase({...a,source});
 assert.ok(p.continueAllowed);assert.equal(p.nextPage,2);assert.equal(p.attempts,2);
 const r=await runPhase({...a,phase:'phase2',deadline:start+400000,prior:p,source});
 assert.equal(r.kind,'provider_terminal_scoped_observation');assert.equal(r.attempts,3);
 assert.equal(r.archivedWholeInventory,false);assert.equal(r.publicationAllowed,false);
 assert.deepEqual(seen,[{endpoint:'change_id',params:{date:'2026-11-21'}},{endpoint:'offers',params:{page:1,year_from:2022,for_sale:1}},
 {endpoint:'offers',params:{page:2,year_from:2022,for_sale:1}}]);
 assert.ok(![...a.storage.m.keys()].some(x=>/complete|current|manifest/.test(x)));
});
test('402/429 before retry, exact request and fail closed on alternate route',async()=>{
 let calls=0;for(const status of [402,429]){
 const read=providerTransport({key:'fixture-only',fetchImpl:async(url,opts)=>{
  calls++;assert.equal(url.origin,'https://api1.auto-api.com');assert.equal(url.pathname,'/api/v3/encar/offers');
  assert.equal(url.searchParams.get('year_from'),'2022');assert.equal(opts.redirect,'error');return new Response(null,{status});}});
 await assert.rejects(read({endpoint:'offers',params:{page:1,year_from:2022,for_sale:1}}),status===402?/payment_required/:/rate_limit_hold/);
 await assert.rejects(read({endpoint:'changes',params:{change_id:1}}),/unapproved_route/);
 }assert.equal(calls,2);
});
test('paid refusal creates a held partial and is not an allowed continuation',async()=>{
 const a=setup();let calls=0;const p=await runPhase({...a,source:r=>{calls++;if(r.endpoint==='change_id')return wire({change_id:1});throw Error('encar_rate_limit_hold');}});
 assert.deepEqual([calls,p.hold,p.continueAllowed],[2,'encar_rate_limit_hold',false]);
 await assert.rejects(runPhase({...a,phase:'phase2',prior:p,source:()=>assert.fail()}),/predecessor/);
});
test('post-checkpoint attempted read drift stops before calling source again',async()=>{
 const a=setup(),p=await runPhase({...a,source:r=>{a.tick();return r.endpoint==='change_id'?wire({change_id:1}):wire({result:[row],meta:{page:1,next_page:2}});}});
 a.storage.m.set(root+'/attempt-3.json',{});
 await assert.rejects(runPhase({...a,phase:'phase2',prior:p,source:()=>assert.fail()}),/predecessor_drift/);
});
test('owner preflight and epoch must hold before supplier; no quota assumption',async()=>{
 const a=setup();
 await assert.rejects(runPhase({...a,checkOwner:()=>{throw Error('encar_owner_scope_hold');},source:()=>assert.fail()}),/owner_scope_hold/);
 assert.throws(()=>authorized({...auth,inExistingPaidScopeVerified:false},tree,start),/unapproved/);
 assert.throws(()=>authorized(auth,tree,start+7200000),/unapproved/);
});

test('drift of owner controls between stages never calls source',async()=>{
 const a=setup(),p=await runPhase({...a,source:r=>{a.tick();return r.endpoint==='change_id'?wire({change_id:1}):wire({result:[row],meta:{page:1,next_page:2}});}});
 await assert.rejects(runPhase({...a,checkOwner:()=>Promise.resolve('changed'),phase:'phase2',prior:p,source:()=>assert.fail()}),/start_mismatch/);
});
test('all four hosted phases can terminate without repeating pages, using one program cap',async()=>{
 const a=setup(), sent=[];
 const source=async r=>{
   sent.push(r);a.tick();
   if(r.endpoint==='change_id')return wire({change_id:111});
   const p=r.params.page;return wire({result:[{...row,inner_id:String(1234570+p)}],meta:{page:p,next_page:p<4?p+1:null}});
 };
 let previous;
 for(const [i,phase] of ['initial','phase2','phase3','phase4'].entries())
   previous=await runPhase({...a,phase,prior:previous,deadline:start+(91+31*i)*1000,source});
 assert.equal(previous.kind,'provider_terminal_scoped_observation');
 assert.equal(previous.attempts,5);
 assert.deepEqual(sent.filter(x=>x.endpoint==='offers').map(x=>x.params.page),[1,2,3,4]);
});
const secondStart=Date.parse('2026-11-22T07:00:00.000Z');
async function priorFixture(){
 const a=setup();
 const current=await runPhase({...a,source:r=>{a.tick();return r.endpoint==='change_id'?wire({change_id:987}):
  wire({result:[row],meta:{page:1,next_page:2}});}});
 return {a,current};
}
function newRun(prior, old){
 const identity={runId:'987654321',attempt:'1',revision:'c'.repeat(40)}, root2=rootFor(identity.runId);
 const records=new Map(), claims=new Map();
 const storage={
  readJson:async(k,alt)=>records.get(k)??alt,
  writeJson:async(k,v,o)=>{assert.ok(k.startsWith(root2+'/'));assert.equal(o.ifNoneMatch,'*');assert.ok(!records.has(k));records.set(k,structuredClone(v));}
 };
 const permit=authorized({...auth,anchorDate:'2026-11-22',checkedAt:new Date(secondStart).toISOString(),
  expiresAt:new Date(secondStart+3600000).toISOString(),predecessor:predecessorFromReceipt(prior)},tree,secondStart);
 return {auth:permit,root:root2,identity,phase:'initial',clock:()=>secondStart,storage,deadline:secondStart+90000,
  checkOwner:()=>undefined,claims,history:(base,n)=>old.storage.readJson(base+'/'+n,null),
  claim:(p,v,create)=>{if(create){assert.ok(!claims.has(p.receiptSha256),'prior claim already exists');claims.set(p.receiptSha256,v);}
   assert.deepEqual(claims.get(p.receiptSha256),v);}};
}
test('cross-run and next UTC day reads predecessor and original dated anchor, no anchor or page1 replay, no predecessor writes',async()=>{
 const {a,current}=await priorFixture(), before=structuredClone(a.storage.m), b=newRun(current,a);
 const seen=[];
 const r=await runPhase({...b,source:x=>{seen.push(x);return wire({result:[{...row,inner_id:'4532234'}],meta:{page:2,next_page:null}});}});
 assert.deepEqual(a.storage.m,before);
 assert.deepEqual(seen,[{endpoint:'offers',params:{page:2,year_from:2022,for_sale:1}}]);
 assert.equal(r.kind,'provider_terminal_scoped_observation');assert.equal(r.cumulativePages,2);
 assert.equal(r.cumulativeReservedAttempts,3);assert.equal(r.attempts,1);
 assert.deepEqual(r.anchor,current.anchor);assert.equal(r.originalRunId,a.identity.runId);
 await assert.rejects(runPhase({...b,source:()=>assert.fail()}),/prior claim already exists/);
});
test('cross-run rejects altered raw anchor, tail, or orphan before reserving or requesting',async()=>{
 for(const file of ['body-1.json','body-2.json','attempt-3.json']){
   const {a,current}=await priorFixture(), b=newRun(current,a);
   a.storage.m.set(root+'/'+file,{tampered:true});
   await assert.rejects(runPhase({...b,source:()=>assert.fail()}),/cross_original_anchor|cross_body_drift|cross_orphan/);
   assert.equal(b.claims.size,0);
 }
});
test('terminal or held previous receipts cannot create a cross-run marker',async()=>{
 const {current}=await priorFixture();
 assert.throws(()=>predecessorFromReceipt({...current,hold:'encar_rate_limit_hold'}),/not_resumable/);
 assert.throws(()=>predecessorFromReceipt({...current,kind:'provider_terminal_scoped_observation'}),/not_resumable/);
});
test('journal reserve denial, readback drift and existing owner all precede provider',async()=>{
 for(const how of ['put_denied','readback_drift','already_reserved']){
   const a=setup(), native=a.storage;
   const fake={...native,async writeJson(k,v,o){if(how==='put_denied')throw Error('acl denied');
    await native.writeJson(k,v,o);
    if(how==='readback_drift')native.m.set(k,{incorrect:true});}};
   if(how==='already_reserved')native.m.set(root+'/scope-start.json',{otherOwner:true});
   await assert.rejects(runPhase({...a,storage:fake,source:()=>assert.fail('provider touched')}),/acl denied|readback_mismatch|already_reserved/);
 }
});
