import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {EventEmitter} from 'node:events';
import {PassThrough,Writable} from 'node:stream';
import {PROFILE,ACCEPTANCE,checkedProfile,sha256,verifyGates,assertServerReceipt,assertRemovalReceipt,assertBrowserReceipt,
  sourceClosureProof,assertSourceClosure} from '../.github/operations/ajes-japan-only-20261124/release-contract.mjs';
import {fixtureReport,browserVerdict,failedBrowserVerdict} from '../.github/operations/ajes-japan-only-20261124/release-browser.mjs';
import {activateTransaction,failureDetails} from '../.github/operations/ajes-japan-only-20261124/release.mjs';
import {acquireAuthority} from '../.github/operations/ajes-japan-only-20261124/release-authority.mjs';
import {AjSshSession} from '../.github/operations/ajes-japan-only-20261124/release-ssh.mjs';

const nonce='a'.repeat(32),source='b'.repeat(40),routes=verifyGates();
const profile={...PROFILE,source,tree:'c'.repeat(40),sourceCalculationVersion:'d'.repeat(64),codeDiffSha256:'e'.repeat(64)};
function server(phase){return {release:source,nonce,phase,exitCode:0,logSha256:'1'.repeat(64),
  baselineSha256:'32fba449b77e40983803483ea7b6cb4ece09afa997c2ae08dd968c675f528c59',
  summary:{marketScope:'',functionalPassed:true,acceptedBaselineEnforced:true,samples:51,routes,acceptedBaselineRoutes:routes},
  phases:routes.flatMap(path=>['warm','after_ttl','after_directory_ttl'].map(performanceGate=>({path,performanceGate,functionalPassed:true})))};}
function removal(phase){return {version:1,acceptance:ACCEPTANCE,release:source,nonce,phase,
  protectedClosureSha256:profile.protectedClosureSha256,passed:true,healthVerified:true,retiredSourcesRejected:true,
  retiredReportRejected:true,anonymousCrmRejected:true,authorityUnchanged:true,japanBoundaryVerified:phase==='private',
  ordinaryCatalogRequests:0,supplierRequests:0,catalogPerformanceRevalidated:false};}
const browser=()=>({schemaVersion:1,acceptance:ACCEPTANCE,kind:'isolated-owner-ui',release:source,tree:profile.tree,
  codeDiffSha256:profile.codeDiffSha256,protectedClosureSha256:profile.protectedClosureSha256,nonce,
  passed:true,uiPassed:true,retiredSourcesAbsent:true,japanFormPreserved:true,retiredRequests:0,widths:[390,1440],
  liveOwnerCrmVerified:false,catalogPerformanceRevalidated:false,reportSha256:'2'.repeat(64)});
function transaction({fail,foreignRollback=false,wrongBrowser=false}={}){
  const calls=[];
  const call=async(name,result)=>{calls.push(name);if(fail===name)throw Error('planned_failure');return result;};
  const io={start:()=>call('start'),identity:()=>call('identity'),fresh:()=>call('fresh'),guard:()=>call('guard'),
    removal:phase=>call('removal-'+phase,removal(phase)),switch:()=>call('switch'),
    publicIdentity:()=>call('public-identity'),browser:()=>call('browser',wrongBrowser?{...browser(),nonce:'f'.repeat(32)}:browser()),
    accept:()=>call('accept'),rollback:()=>call('rollback').then(()=>{if(foreignRollback)throw Error('foreign_ingress');}),cleanup:()=>call('cleanup')};
  return {io,calls};
}

test('profile admits only the AJ application delta and exact retained inventory',()=>{
  assert.equal(checkedProfile(profile),profile);
  for(const name of ['packages/engine/src/index.ts','data/markets/markets.json','apps/web/lib/encyclopedia/calculation-index.ts',
    'apps/web/lib/catalog/customs-pricing.ts','apps/web/package.json','.github/workflows/catalog-refresh-china.yml']){
    assert.throws(()=>checkedProfile({...profile,codePaths:[name]}),/profile_paths|protected_path|profile_closure/);
  }
  assert.throws(()=>checkedProfile({...profile,inventorySha256:'f'.repeat(64)}),/inventory_digest/);
  assert.throws(()=>checkedProfile({...profile,source:null}),/profile_source/);
  assert.throws(()=>checkedProfile({...profile,acceptance:'skip_catalog_checks'}),/profile_acceptance/);
});

test('the price guard exception allows only deleting the obsolete AJ policy',()=>{
  const name='apps/web/lib/catalog/ajes-price-policy.ts',before='100644 blob '+'5'.repeat(40);
  const candidate={...profile,codePaths:[...new Set([...profile.codePaths,name])].sort(),
    reviewedClosureChanges:[...profile.reviewedClosureChanges.filter(row=>row[0]!==name),[name,before,null]]
      .sort((a,b)=>a[0].localeCompare(b[0]))};
  assert.doesNotThrow(()=>checkedProfile(candidate));
  const changed={...candidate,reviewedClosureChanges:candidate.reviewedClosureChanges.map(row=>
    row[0]===name?[name,before,'100644 blob '+'6'.repeat(40)]:row)};
  assert.throws(()=>checkedProfile(changed),/protected_path/);
  const different='apps/web/lib/catalog/customs-pricing.ts';
  assert.throws(()=>checkedProfile({...profile,codePaths:[...profile.codePaths,different].sort(),
    reviewedClosureChanges:[...profile.reviewedClosureChanges,[different,before,null]]}),/protected_path/);
});

test('ordinary full server receipt and frozen baseline remain unchanged',()=>{
  assert.equal(routes.length,17);assert.doesNotThrow(()=>assertServerReceipt(server('private'),nonce,'private',profile,routes));
  for(const mutate of [x=>x.phases.pop(),x=>x.summary.routes.pop(),x=>x.summary.acceptedBaselineEnforced=false,
    x=>x.summary.marketScope='china,korea',x=>x.exitCode=1,x=>x.phases[0].functionalPassed=false]){
    const value=structuredClone(server('private'));mutate(value);
    assert.throws(()=>assertServerReceipt(value,nonce,'private',profile,routes));
  }
});

test('scoped removal requires every contract and cannot claim a catalog speed pass',()=>{
  for(const phase of ['private','public'])assert.doesNotThrow(()=>assertRemovalReceipt(removal(phase),nonce,phase,profile));
  for(const change of [{passed:false},{healthVerified:false},{authorityUnchanged:false},{retiredSourcesRejected:false},
    {anonymousCrmRejected:false},{retiredReportRejected:false},{japanBoundaryVerified:false},{ordinaryCatalogRequests:1},
    {supplierRequests:1},{catalogPerformanceRevalidated:true},{nonce:'f'.repeat(32)},{protectedClosureSha256:'f'.repeat(64)}])
    assert.throws(()=>assertRemovalReceipt({...removal('private'),...change},nonce,'private',profile),/removal_failed/);
});

test('browser requires exact source, nonce and rendered owner controls without a live-CRM claim',()=>{
  assert.doesNotThrow(()=>assertBrowserReceipt(browser(),nonce,profile));
  for(const change of [{nonce:'f'.repeat(32)},{release:'f'.repeat(40)},{passed:false},{uiPassed:false},
    {retiredSourcesAbsent:false},{japanFormPreserved:false},{retiredRequests:1},{widths:[390]},
    {liveOwnerCrmVerified:true},{catalogPerformanceRevalidated:true},{codeDiffSha256:'f'.repeat(64)}])
    assert.throws(()=>assertBrowserReceipt({...browser(),...change},nonce,profile),/browser_failed/);
  assert.throws(()=>assertBrowserReceipt(failedBrowserVerdict(nonce,profile),nonce,profile),/browser_failed/);
});

test('UI evidence requires both actual fixture completions, screenshots and the reviewed source',()=>{
  const input={stdout:'Owner controls 1440: passed\nOwner controls 390: passed\n',exitCode:0,
    sourceProof:{...profile,source:profile.source,clean:true},fixtureSha256:'3'.repeat(64),
    screenshots:[390,1440].map(width=>({width,sha256:'4'.repeat(64),bytes:1024}))};
  const report=fixtureReport(input,profile),raw=JSON.stringify(report);
  const verdict=browserVerdict({raw,exitCode:0,nonce},profile);
  assert.equal(verdict.reportSha256,sha256(raw));assert.equal(verdict.kind,'isolated-owner-ui');
  assert.equal(verdict.liveOwnerCrmVerified,false);assert.equal(verdict.catalogPerformanceRevalidated,false);
  assert.equal(Object.hasOwn(verdict,'speedPassed'),false);
  for(const change of [{exitCode:1},{stdout:'Owner controls 390: passed\n'},
    {stdout:input.stdout+'Owner controls 390: passed\n'},{screenshots:input.screenshots.slice(1)},
    {sourceProof:{...input.sourceProof,codeDiffSha256:'f'.repeat(64)}},
    {sourceProof:{...input.sourceProof,clean:false}}])
    assert.throws(()=>fixtureReport({...input,...change},profile),/ui_fixture_/);
  assert.throws(()=>browserVerdict({raw,exitCode:1,nonce},profile),/browser_fixture_failed/);
  assert.throws(()=>browserVerdict({raw:JSON.stringify({...report,liveOwnerCrmVerified:true}),exitCode:0,nonce},profile),/browser_failed/);
});

test('runtime closure rejects an unreviewed engine edit and any calculator algorithm edit',()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'aj-removal-proof-'));
  const git=args=>execFileSync('/usr/bin/git',['-C',directory,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  const write=(name,value)=>{fs.mkdirSync(path.dirname(path.join(directory,name)),{recursive:true});fs.writeFileSync(path.join(directory,name),value);};
  const commit=()=>{git(['add','.']);git(['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','core.hooksPath=/dev/null','commit','--quiet','-m','fixture']);return git(['rev-parse','HEAD']);};
  try{
    git(['init','--quiet']);
    write('scripts/catalog-calculation-version.mjs','export const version=1;\n');
    write('packages/engine/index.ts','export const fee=10;\n');
    write('apps/web/lib/catalog/ajes-access-policy.ts','export const retired=false;\n');
    const retained=commit();
    write('apps/web/lib/catalog/ajes-access-policy.ts','export const retired=true;\n');
    const candidate=commit(),reviewed=sourceClosureProof(directory,retained,candidate);
    assert.deepEqual(reviewed.reviewedClosureChanges.map(row=>row[0]),['apps/web/lib/catalog/ajes-access-policy.ts']);
    assert.equal(reviewed.protectedClosureRecords,2);assert.doesNotThrow(()=>assertSourceClosure(reviewed,reviewed));
    write('packages/engine/index.ts','export const fee=99;\n');
    const unreviewed=sourceClosureProof(directory,retained,commit());
    assert.throws(()=>assertSourceClosure(unreviewed,reviewed),/source_(protectedClosure|reviewedClosureChanges)/);
    write('scripts/catalog-calculation-version.mjs','export const version=2;\n');
    assert.throws(()=>sourceClosureProof(directory,retained,commit()),/calculation_algorithm_changed/);
  }finally{fs.rmSync(directory,{recursive:true,force:true});}
});

test('complete removal renders UI before ingress switch and checks public identity before acceptance',async()=>{
  const {io,calls}=transaction();const result=await activateTransaction(io,{nonce,profile,routes});
  assert.equal(result.accepted,true);assert.equal(result.ingressState,'candidate');
  assert.deepEqual(calls,['start','identity','removal-private','browser','guard','fresh','switch','public-identity',
    'removal-public','guard','identity','accept']);
  assert.equal(result.catalogPerformanceRevalidated,false);assert.equal(result.liveOwnerCrmVerified,false);
});

test('a private gate failure never switches ingress and stops only the owned candidate',async()=>{
  const {io,calls}=transaction({fail:'removal-private'});
  await assert.rejects(activateTransaction(io,{nonce,profile,routes}),error=>{
    assert.equal(error.ajOutcome.ingressState,'retained');
    assert.equal(error.ajOutcome.failedPhase,'removal-private');
    assert.equal(error.ajOutcome.lastCompletedPhase,'identity');
    return true;
  });
  assert.equal(calls.includes('switch'),false);assert.equal(calls.includes('rollback'),false);assert.equal(calls.at(-1),'cleanup');
});

for(const failure of ['switch','public-identity','removal-public','accept'])test(failure+' failure restores ingress before cleanup',async()=>{
  const {io,calls}=transaction({fail:failure});
  const previous={switch:'fresh','public-identity':'switch','removal-public':'public-identity',accept:'identity'};
  await assert.rejects(activateTransaction(io,{nonce,profile,routes}),error=>{
    assert.equal(error.ajOutcome.accepted,false);assert.equal(error.ajOutcome.ingressState,'retained');
    assert.equal(error.ajOutcome.failedPhase,failure);assert.equal(error.ajOutcome.lastCompletedPhase,previous[failure]);
    return true;
  });
  assert.deepEqual(calls.slice(-2),['rollback','cleanup']);
});

test('wrong browser nonce blocks switching and cleans the private candidate',async()=>{
  const {io,calls}=transaction({wrongBrowser:true});
  await assert.rejects(activateTransaction(io,{nonce,profile}),error=>{
    assert.equal(error.ajOutcome.ingressState,'retained');assert.equal(error.ajOutcome.failedPhase,'browser');
    assert.equal(error.ajOutcome.lastCompletedPhase,'removal-private');return true;
  });
  assert.equal(calls.includes('switch'),false);assert.equal(calls.includes('rollback'),false);assert.equal(calls.at(-1),'cleanup');
});

test('a foreign ingress prevents stopping a potentially routed candidate',async()=>{
  for(const foreignRollback of [false,true]){
    const {io,calls}=transaction({fail:'removal-public',foreignRollback});
    await assert.rejects(activateTransaction(io,{nonce,profile,routes}),error=>{
      assert.equal(error.ajOutcome.ingressState,foreignRollback?'unknown':'retained');
      assert.equal(error.ajOutcome.failedPhase,'removal-public');assert.equal(error.ajOutcome.lastCompletedPhase,'public-identity');
      return true;
    });
    assert.equal(calls.includes('accept'),false);assert.equal(calls.includes('cleanup'),!foreignRollback);
  }
});

function sshFixture(){
  const child=new EventEmitter(),sent=[],stages=[];
  child.stdin=new Writable({write(chunk,_encoding,done){sent.push(JSON.parse(chunk.toString()));done();}});
  child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>child.emit('close',1,null);
  const session=new AjSshSession({process:child,nonce,authority:{},browser:()=>{},onStage:phase=>stages.push(phase)});
  session.message({kind:'ready',source:PROFILE.source,nonce});
  return {session,sent,stages,finish:()=>child.emit('close',0,null)};
}

test('SSH failure phase comes from the local pending command and survives later cleanup',async()=>{
  const f=sshFixture();
  try{
    for(const method of ['init','image']){
      const request=f.session.request(method,{Env:['PRIVATE_FIXTURE']});await f.session.writes;
      f.session.message({kind:'result',id:request.id,value:{private:'PRIVATE_FIXTURE'},phase:'/root/PRIVATE_FIXTURE'});
      await request.result;
    }
    const request=f.session.request('start');await f.session.writes;
    f.session.message({kind:'error',id:request.id,code:'home_host_aj_docker_http_get_image_inspect_404',
      failedPhase:'/root/PRIVATE_FIXTURE',lastCompletedPhase:'accept',body:'AJES_API_PASSWORD=PRIVATE_FIXTURE'});
    let failure;
    await assert.rejects(request.result,error=>{failure=error;return true;});
    const cleanup=f.session.request('cleanup');await f.session.writes;
    f.session.message({kind:'result',id:cleanup.id,value:{private:'PRIVATE_FIXTURE'}});await cleanup.result;
    assert.deepEqual(failureDetails(failure,{phase:'close',lastCompletedPhase:'close'}),{
      failureCode:'home_host_aj_docker_http_get_image_inspect_404',failedPhase:'start',lastCompletedPhase:'image'});
    assert.equal(f.session.lastCompletedPhase,'cleanup');
    assert.deepEqual(f.stages,['init','image','cleanup']);
    assert.doesNotMatch(JSON.stringify({error:failureDetails(failure),stages:f.stages}),/PRIVATE_FIXTURE|AJES_API_PASSWORD|\/root\//);
  }finally{f.finish();}
});

test('SSH disconnect identifies its pending phase without exposing a raw transport error',async()=>{
  const f=sshFixture();
  try{
    const initial=f.session.request('init');await f.session.writes;
    f.session.message({kind:'result',id:initial.id,value:{}});await initial.result;
    const pending=f.session.request('image');await f.session.writes;
    f.session.fail(Error('socket /root/PRIVATE_FIXTURE AJES_API_PASSWORD=PRIVATE_FIXTURE'));
    await assert.rejects(pending.result,error=>{
      assert.deepEqual(failureDetails(error),{failureCode:'aj_ssh_request_failed',failedPhase:'image',lastCompletedPhase:'init'});
      assert.doesNotMatch(error.message,/PRIVATE_FIXTURE|\/root\//);return true;
    });
    assert.throws(()=>f.session.request('/root/PRIVATE_FIXTURE'),/aj_ssh_method/);
    assert.deepEqual(f.sent.map(row=>row.method),['init','image']);
  }finally{f.finish();}
});

test('receipt diagnostics reject arbitrary phase text and retain the local controller phase',()=>{
  const error=Object.assign(Error('PRIVATE_FIXTURE https://private.example/secret'),{
    failedPhase:'/root/PRIVATE_FIXTURE',lastCompletedPhase:'AJES_API_PASSWORD=PRIVATE_FIXTURE'});
  assert.deepEqual(failureDetails(error,{phase:'controls-retire',lastCompletedPhase:'plan'}),{
    failureCode:'aj_release_failed',failedPhase:'controls-retire',lastCompletedPhase:'plan'});
});

test('a local publication guard failure keeps its exact phase before cleanup',async()=>{
  const {io,calls}=transaction({fail:'guard'});
  await assert.rejects(activateTransaction(io,{nonce,profile,routes}),error=>{
    assert.equal(error.ajOutcome.failedPhase,'publication-guard');
    assert.equal(error.ajOutcome.lastCompletedPhase,'browser');return true;
  });
  assert.equal(calls.includes('switch'),false);assert.equal(calls.at(-1),'cleanup');
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
