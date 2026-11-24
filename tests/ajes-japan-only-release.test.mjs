import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PROFILE,checkedProfile,sha256,verifyGates,assertServerReceipt,assertBrowserReceipt} from '../.github/operations/ajes-japan-only-20261124/release-contract.mjs';
import {activateTransaction} from '../.github/operations/ajes-japan-only-20261124/release.mjs';
import {acquireAuthority} from '../.github/operations/ajes-japan-only-20261124/release-authority.mjs';

const nonce='a'.repeat(32),source='b'.repeat(40),routes=verifyGates();
const profile={...PROFILE,source,tree:'c'.repeat(40),sourceCalculationVersion:'d'.repeat(64),codeDiffSha256:'e'.repeat(64),
  codePaths:['apps/web/lib/catalog/ajes-access-policy.ts','tests/ajes-japan-only.test.ts']};
function server(phase){return {release:source,nonce,phase,exitCode:0,logSha256:'1'.repeat(64),
  baselineSha256:'32fba449b77e40983803483ea7b6cb4ece09afa997c2ae08dd968c675f528c59',
  summary:{marketScope:'',functionalPassed:true,acceptedBaselineEnforced:true,samples:51,routes,acceptedBaselineRoutes:routes},
  phases:routes.flatMap(path=>['warm','after_ttl','after_directory_ttl'].map(performanceGate=>({path,performanceGate,functionalPassed:true})))};}
const browser=()=>({schemaVersion:1,release:source,nonce,passed:true,functionalPassed:true,speedPassed:true,reportSha256:'2'.repeat(64)});
function transaction({fail,foreignRollback=false,wrongBrowser=false}={}){
  const calls=[];
  const call=async(name,result)=>{calls.push(name);if(fail===name)throw Error('planned_failure');return result;};
  const io={start:()=>call('start'),identity:()=>call('identity'),fresh:()=>call('fresh'),guard:()=>call('guard'),
    aj:phase=>call('aj-'+phase,{passed:true}),server:phase=>call('server-'+phase,server(phase)),switch:()=>call('switch'),
    publicIdentity:()=>call('public-identity'),browser:()=>call('browser',wrongBrowser?{...browser(),nonce:'f'.repeat(32)}:browser()),
    accept:()=>call('accept'),rollback:()=>call('rollback').then(()=>{if(foreignRollback)throw Error('foreign_ingress');}),cleanup:()=>call('cleanup')};
  return {io,calls};
}

test('profile admits only the AJ application delta and exact retained inventory',()=>{
  assert.equal(checkedProfile(profile),profile);
  for(const name of ['packages/engine/src/index.ts','data/markets/markets.json','apps/web/lib/encyclopedia/calculation-index.ts',
    'apps/web/lib/catalog/customs-pricing.ts','apps/web/package.json','.github/workflows/catalog-refresh-china.yml']){
    assert.throws(()=>checkedProfile({...profile,codePaths:[name]}),/profile_paths|protected_path/);
  }
  assert.throws(()=>checkedProfile({...profile,inventorySha256:'f'.repeat(64)}),/inventory_digest/);
  assert.throws(()=>checkedProfile({...profile,source:null}),/profile_source/);
});

test('all17 frozen server routes and allthree phases remain mandatory',()=>{
  assert.equal(routes.length,17);assert.doesNotThrow(()=>assertServerReceipt(server('private'),nonce,'private',profile,routes));
  for(const mutate of [x=>x.phases.pop(),x=>x.summary.routes.pop(),x=>x.summary.acceptedBaselineEnforced=false,
    x=>x.summary.marketScope='china,korea',x=>x.exitCode=1,x=>x.phases[0].functionalPassed=false]){
    const value=structuredClone(server('private'));mutate(value);
    assert.throws(()=>assertServerReceipt(value,nonce,'private',profile,routes));
  }
});

test('browser requires exact release nonce, functionality and speed together',()=>{
  assert.doesNotThrow(()=>assertBrowserReceipt(browser(),nonce,profile));
  for(const change of [{nonce:'f'.repeat(32)},{release:'f'.repeat(40)},{passed:false},{functionalPassed:false},{speedPassed:false}])
    assert.throws(()=>assertBrowserReceipt({...browser(),...change},nonce,profile),/browser_failed/);
});

test('complete release uses both server gates and browser before acceptance',async()=>{
  const {io,calls}=transaction();const result=await activateTransaction(io,{nonce,profile,routes});
  assert.equal(result.accepted,true);assert.equal(result.ingressState,'candidate');
  assert.deepEqual(calls,['start','identity','aj-private','server-private','guard','fresh','switch','public-identity',
    'aj-public','server-public','browser','guard','identity','accept']);
});

test('a private gate failure never switches ingress and stops only the owned candidate',async()=>{
  const {io,calls}=transaction({fail:'server-private'});
  await assert.rejects(activateTransaction(io,{nonce,profile,routes}),error=>error.ajOutcome.ingressState==='retained');
  assert.equal(calls.includes('switch'),false);assert.equal(calls.includes('rollback'),false);assert.equal(calls.at(-1),'cleanup');
});

for(const failure of ['switch','public-identity','aj-public','server-public','browser','accept'])test(failure+' failure restores ingress before cleanup',async()=>{
  const {io,calls}=transaction({fail:failure});
  await assert.rejects(activateTransaction(io,{nonce,profile,routes}),error=>error.ajOutcome.accepted===false&&error.ajOutcome.ingressState==='retained');
  assert.deepEqual(calls.slice(-2),['rollback','cleanup']);
});

test('wrong browser nonce rolls back; a foreign ingress prevents candidate cleanup',async()=>{
  for(const foreignRollback of [false,true]){
    const {io,calls}=transaction({wrongBrowser:true,foreignRollback});
    await assert.rejects(activateTransaction(io,{nonce,profile,routes}),error=>error.ajOutcome.ingressState===(foreignRollback?'unknown':'retained'));
    assert.equal(calls.includes('accept'),false);assert.equal(calls.includes('cleanup'),!foreignRollback);
  }
});

test('authority never steals an active foreign lease',async()=>{
  let writes=0;
  const storage={driver:'object',readJsonWithMeta:async()=>({found:true,etag:'owner',value:{operationId:'publisher',lockedUntil:new Date(Date.now()+60000).toISOString()}}),
    writeJson:async()=>{writes++;}};
  await assert.rejects(acquireAuthority({storage,nonce,readLiveIdentity:async()=>({}),heartbeat:false}),/publisher_busy/);
  assert.equal(writes,0);
});

test('workflow carries only the AJ release entry and preserves frozen helpers',()=>{
  const body=fs.readFileSync('.github/workflows/aj-system-japan-only.yml','utf8');
  assert.match(body,/verify-frozen-speed-baselines\.mjs/);assert.match(body,/release-speed-guard-contract\.test\.mjs/);
  assert.match(body,/release\.mjs --activate/);assert.match(body,/release-host\.test\.py/);
  assert.doesNotMatch(body,/workflow_run:|schedule:|catalog-refresh|deploy-yandex|image\.tar\s*$/m);
  const loader=fs.readFileSync('.github/operations/ajes-japan-only-20261124/release-loader.py','utf8');
  assert.match(loader,/LOCK_EX \| fcntl\.LOCK_NB/);assert.match(loader,/root\.mkdir\(mode=0o700\)/);
  assert.match(loader,/profile\['source'\] == release/);
  assert.equal(PROFILE.inventorySha256,sha256(JSON.stringify(PROFILE.inventory)));
});
