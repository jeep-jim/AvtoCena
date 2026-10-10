import test from 'node:test';
import assert from 'node:assert/strict';
import {liveBudgetRelease,budgetPreparationDecision,verifyBudgetContext,budgetReadyKey,budgetAlreadyReady} from '../scripts/catalog-budget-runtime.mjs';
const release='a'.repeat(40),generationId='gen_1791555837022_9a2cec74';
test('runtime warmup uses only a healthy exact production release, not a docs or feed commit',async()=>{
  let requested='';
  assert.equal(await liveBudgetRelease(async(url,options)=>{requested=url;assert.equal(options.redirect,'error');return Response.json({ok:true,releaseSha:release});}),release);
  assert.equal(requested,'https://avtocena.com/api/health');
  for(const value of [{ok:false,releaseSha:release},{ok:true,releaseSha:'main'},{ok:true,releaseSha:'a'.repeat(39)},{ok:true}]){
    await assert.rejects(liveBudgetRelease(async()=>Response.json(value)),/release_invalid/);
  }
  await assert.rejects(liveBudgetRelease(async()=>new Response('',{status:503})),/health_http_503/);
});
test('an active publication skips work, expired locks permit it, malformed state fails closed',()=>{
  const now=Date.now(),manifest={generationId};
  assert.equal(budgetPreparationDecision(manifest,null,now).skip,false);
  assert.equal(budgetPreparationDecision(manifest,{lockedUntil:'',finishedAt:new Date(now).toISOString()},now).skip,false);
  assert.equal(budgetPreparationDecision(manifest,{lockedUntil:new Date(now+1000).toISOString()},now).skip,true);
  assert.equal(budgetPreparationDecision(manifest,{lockedUntil:new Date(now-1000).toISOString()},now).skip,false);
  assert.throws(()=>budgetPreparationDecision(null,null),/generation_missing/);
  assert.throws(()=>budgetPreparationDecision(manifest,{lockedUntil:'broken'}),/lock_invalid/);
});
test('deployment or publication during preparation cannot be reported as verified',async()=>{
  const context={release,generationId,readRelease:async()=>release,readState:async()=>({manifest:{generationId},lock:null})};
  await verifyBudgetContext(context);
  await assert.rejects(verifyBudgetContext({...context,readRelease:async()=>'b'.repeat(40)}),/release_changed/);
  await assert.rejects(verifyBudgetContext({...context,readState:async()=>({manifest:{generationId:'gen_next'},lock:null})}),/publication_changed/);
  await assert.rejects(verifyBudgetContext({...context,readState:async()=>({manifest:{generationId},lock:{lockedUntil:new Date(Date.now()+60000).toISOString()}})}),/publication_changed/);
});

test('hourly preparation skips only a fresh verified identical calculation context',()=>{
 const now=Date.now(),key=budgetReadyKey(release,generationId,{china:'rates-and-settings'},2),saved={version:1,verified:true,key,at:now};
 assert.equal(budgetAlreadyReady(saved,key,now),true);
 for(const other of [budgetReadyKey(release,'gen_other',{china:'rates-and-settings'},2),budgetReadyKey(release,generationId,{china:'new-rates'},2),budgetReadyKey(release,generationId,{china:'rates-and-settings'},1)])assert.equal(budgetAlreadyReady(saved,other,now),false);
 assert.equal(budgetAlreadyReady({...saved,verified:false},key,now),false);
 assert.equal(budgetAlreadyReady(saved,key,now+20*3600000),false);
 assert.equal(budgetAlreadyReady({...saved,at:now+1},key,now),false);
});
