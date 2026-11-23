import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {HOME_UI,GATE_FILES,sha256,verifyHomeGateFiles} from '../.github/operations/home-ui-only-20261123/contract.mjs';
import {activateWithSession,checkedPrepared} from '../.github/operations/home-ui-activation-20261123/runner.mjs';
import {approvalOperation,parseApprovalOperation,checkApprovalInvocation,APPROVAL_MARKER,INVENTORY_FILE,REVIEWED_INVENTORY_SHA}
  from '../.github/operations/home-ui-activation-20261123/profile.mjs';
import {assertPublicationQuiescence,controllerCodeFingerprint,githubReader,findPlanApproval} from '../.github/operations/home-ui-activation-20261123/github-evidence.mjs';
import {browserVerdict} from '../.github/operations/home-ui-activation-20261123/browser.mjs';

const root=path.resolve(fileURLToPath(new URL('..',import.meta.url))),nonce='a'.repeat(32);
const inventory=JSON.parse(await fs.readFile(path.join(root,INVENTORY_FILE),'utf8'));
const {routes}=verifyHomeGateFiles(root);
const proof=()=>({version:1,clean:true,closureUnchanged:true,...Object.fromEntries(['source','tree','retainedSource','retainedTree',
  'sourceCalculationVersion','servingCalculationVersion','codeDiffSha256','sourceClosureRecords','codePaths'].map(key=>[key,structuredClone(HOME_UI[key])]))});
const server=phase=>({release:HOME_UI.source,nonce,phase,exitCode:0,logSha256:'b'.repeat(64),
  baselineSha256:GATE_FILES['docs/operations/2026-11-11-accepted-speed-baseline.json'],
  summary:{performanceGate:'summary',marketScope:'',functionalPassed:true,acceptedBaselineEnforced:true,
    samples:51,routes:[...routes],acceptedBaselineRoutes:[...routes]},
  phases:routes.flatMap(path=>['warm','after_ttl','after_directory_ttl'].map(performanceGate=>({path,performanceGate,functionalPassed:true})))});
const browser=()=>({schemaVersion:1,release:HOME_UI.source,nonce,passed:true,functionalPassed:true,speedPassed:true,reportSha256:'c'.repeat(64)});

function transition(fault){
  const events=[];
  let routed=false,accepted=false;
  const authority={lease:{operationId:'home-ui-c162-'+nonce},guard:async()=>{events.push('authority');},
    setIngress:value=>events.push('authority:'+value),release:async()=>{events.push('release');if(fault==='release')throw Error('synthetic_release');},
    stopHeartbeat:async()=>events.push('retain-ttl')};
  const session={
    async call(method){events.push(method);
      if(method==='start')return {id:'2'.repeat(64),imageId:'sha256:'+'d'.repeat(64),source:HOME_UI.source};
      if(method==='switch'){routed=true;if(fault==='switch')throw Error('synthetic_after_switch');}
      if(method==='rollback'){if(fault==='foreign')throw Error('synthetic_foreign_ingress');routed=false;}
      if(method==='accept')accepted=true;
      if(method==='cleanup')assert.equal(routed,false);
      if(method==='server-private'){const value=server('private');if(fault==='partial')value.phases.pop();return value;}
      if(method==='server-public'){if(fault==='foreign')throw Error('synthetic_public_failed');return server('public');}
      if(method==='browser'){const value=browser();if(fault==='browser')value.speedPassed=false;return value;}
      return {verified:true};
    },
    async upload(method,filename){events.push('upload:'+method);assert.ok(filename.startsWith('/synthetic/'));},
    async close(){events.push('close');if(routed&&!accepted)throw Error('synthetic_close_routed');return {closed:true};},
    abort:()=>events.push('abort'),
  };
  const options={session,authority,sourceProof:proof(),controllerRoot:root,
    receipt:{plan:{nonce,imageArchiveBytes:42},planSha256:'e'.repeat(64),inventory},
    verifyBuild:async()=>events.push('build-proof'),bind:async()=>events.push('private-binding'),
    resources:{},imagePath:'/synthetic/image.tar',indexPath:'/synthetic/private.json'};
  return {events,options};
}

test('concrete adapter drives both full 17x3 gates, nonce browser and closes remote ownership before releasing lease',async()=>{
  const f=transition(),result=await activateWithSession(f.options);
  assert.equal(result.accepted,true);assert.equal(result.leaseReleaseVerified,true);
  for(const phase of ['private','public'])assert.equal(result.evidence[phase+'Server'].phases.length,51);
  const required=['init','fresh','build-proof','private-binding','upload:image','upload:private-index','resources','start',
    'parity-private','server-private','switch','public-identity','parity-public','server-public','browser','accept','close','release'];
  let position=-1;for(const step of required){const next=f.events.indexOf(step,position+1);assert.ok(next>position,step);position=next;}
  assert.equal(f.events.includes('rollback'),false);
});

test('missing server phase, browser failure and an error after ingress write all roll back only through retained proof',async()=>{
  for(const fault of ['partial','browser','switch']){
    const f=transition(fault);let failure;
    await assert.rejects(activateWithSession(f.options),error=>{failure=error;return true;});
    assert.equal(failure.homeUiOutcome.accepted,false);assert.equal(failure.homeUiOutcome.ingressState,'retained');
    assert.equal(f.events.includes('accept'),false);assert.ok(f.events.includes('cleanup'));
    if(fault==='partial')assert.equal(f.events.includes('switch'),false);
    else assert.ok(f.events.indexOf('rollback')<f.events.indexOf('retained-identity')&&f.events.indexOf('retained-identity')<f.events.indexOf('cleanup'));
    assert.ok(f.events.indexOf('close')<f.events.indexOf('release'));
  }
});

test('foreign ingress keeps the candidate and bounded lease; release failure after acceptance preserves accepted fact',async()=>{
  const f=transition('foreign');let failed;
  await assert.rejects(activateWithSession(f.options),error=>{failed=error;return true;});
  assert.equal(failed.homeUiOutcome.ingressState,'unknown');assert.equal(failed.homeUiOutcome.leaseReleaseVerified,false);
  assert.equal(f.events.includes('cleanup'),false);assert.equal(f.events.includes('release'),false);assert.ok(f.events.includes('retain-ttl'));
  const g=transition('release');
  await assert.rejects(activateWithSession(g.options),error=>error.homeUiOutcome.accepted===true&&error.homeUiOutcome.leaseReleaseVerified===false);
  assert.equal(g.events.includes('rollback'),false);
});

function prepared(){
  const source=proof(),resourceFiles={'home-bootstrap.mjs':'f'.repeat(64)},controllerSha='1'.repeat(40);
  const imageBuild={version:1,status:'verified_exact_home_image_build',activationAuthorized:false,sourceProof:source,
    source:HOME_UI.source,tree:HOME_UI.tree,sourceCalculationVersion:HOME_UI.sourceCalculationVersion,
    intendedServingCalculationVersion:HOME_UI.servingCalculationVersion,imageUnpackedBytes:12345,imageArchiveSha256:'e'.repeat(64),
    modelAssetSha256:'ee5c872e9127430890f58abf239cddfa48553f86c3032799c9c29953b6109662',
    imageId:'sha256:'+'2'.repeat(64),controllerSha,privateIndexInImage:false,resourceProbePassed:true,nodeVersion:'v24.22.1',resourceFiles};
  const plan={version:1,source:HOME_UI.source,tree:HOME_UI.tree,sourceCalculationVersion:HOME_UI.sourceCalculationVersion,
    servingCalculationVersion:HOME_UI.servingCalculationVersion,privateIndexDigest:HOME_UI.privateIndexDigest,
    inventorySha256:REVIEWED_INVENTORY_SHA,nonce,imageBuild,imageId:imageBuild.imageId,resourceFiles,
    privateBindingPlanSha256:'3'.repeat(64),privateFileSha256:'4'.repeat(64),privateFileBytes:12,imageArchiveBytes:34};
  return {version:1,status:'awaiting_exact_home_plan_review',activationAuthorized:false,runId:'123',controllerSha,
    createdAt:'2026-11-23T10:00:00Z',reviewExpiresAt:'2026-11-23T10:20:00Z',plan,planSha256:sha256(JSON.stringify(plan)),inventory};
}

test('a reviewed plan cannot be reused for another run/image/source or after its review window',()=>{
  const receipt=prepared(),options={runId:'123',controllerSha:receipt.controllerSha,now:Date.parse('2026-11-23T10:01:00Z')};
  assert.doesNotThrow(()=>checkedPrepared(receipt,options));
  for(const change of [r=>r.runId='124',r=>r.plan.imageId='sha256:'+'5'.repeat(64),r=>r.plan.source='6'.repeat(40),
    r=>r.plan.imageBuild.privateIndexInImage=true,r=>r.reviewExpiresAt='2026-11-23T10:00:30Z']){
    const bad=structuredClone(receipt);change(bad);assert.throws(()=>checkedPrepared(bad,options));
  }
  assert.equal(sha256(JSON.stringify(inventory)),REVIEWED_INVENTORY_SHA);
});

const git=(root,args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
async function fixture(){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'home-plan-marker-'));
  git(root,['init','-q']);git(root,['config','user.name','Offline fixture']);git(root,['config','user.email','fixture@example.invalid']);
  await fs.writeFile(path.join(root,'code.txt'),'code');git(root,['add','.']);git(root,['commit','-qm','base']);
  return {root,parent:git(root,['rev-parse','HEAD'])};
}

test('approval is an actual one-marker main push with exact plan/run/nonce; wrong parent, extra file, forced and replay fail',async()=>{
  for(const fault of [null,'parent','extra','forced','ref','attempt']){
    const f=await fixture();const eventFile=path.join(os.tmpdir(),path.basename(f.root)+'-event.json');
    try{
      const tuple={runId:'123',nonce,planSha256:'b'.repeat(64)};
      assert.deepEqual(parseApprovalOperation(approvalOperation(tuple)),tuple);
      await fs.mkdir(path.dirname(path.join(f.root,APPROVAL_MARKER)),{recursive:true});
      await fs.writeFile(path.join(f.root,APPROVAL_MARKER),JSON.stringify({version:1,operation:approvalOperation(tuple),approvedSourceSha:fault==='parent'?'0'.repeat(40):f.parent}));
      if(fault==='extra')await fs.writeFile(path.join(f.root,'code.txt'),'changed');
      git(f.root,['add','.']);git(f.root,['commit','-qm','marker']);const sha=git(f.root,['rev-parse','HEAD']);
      await fs.writeFile(eventFile,JSON.stringify({before:f.parent,after:sha,ref:'refs/heads/main',forced:fault==='forced',created:false,deleted:false}));
      const env={GITHUB_REPOSITORY:'jeep-jim/AvtoCena',GITHUB_REPOSITORY_ID:'1289722938',GITHUB_REF:fault==='ref'?'refs/heads/foreign':'refs/heads/main',
        GITHUB_RUN_ATTEMPT:fault==='attempt'?'2':'1',GITHUB_EVENT_NAME:'push',GITHUB_SHA:sha,GITHUB_EVENT_PATH:eventFile,GITHUB_RUN_ID:'999'};
      if(fault)assert.throws(()=>checkApprovalInvocation(f.root,env));
      else{const value=checkApprovalInvocation(f.root,env);assert.equal(value.planSha256,tuple.planSha256);assert.equal(value.approvalRunId,'999');}
    }finally{await fs.rm(f.root,{recursive:true,force:true});await fs.rm(eventFile,{force:true});}
  }
  assert.throws(()=>parseApprovalOperation('approve-home-ui-anything'));
});

test('controller CI fingerprint permits short notes/markers but includes executable code and frozen JSON baselines',async()=>{
  const f=await fixture();try{
    const original=controllerCodeFingerprint(f.root,f.parent);
    await fs.mkdir(path.join(f.root,'docs'),{recursive:true});await fs.writeFile(path.join(f.root,'docs/note.md'),'short');
    git(f.root,['add','.']);git(f.root,['commit','-qm','note']);assert.equal(controllerCodeFingerprint(f.root,git(f.root,['rev-parse','HEAD'])),original);
    await fs.writeFile(path.join(f.root,'docs/baseline.json'),'{}');git(f.root,['add','.']);git(f.root,['commit','-qm','baseline']);
    assert.notEqual(controllerCodeFingerprint(f.root,git(f.root,['rev-parse','HEAD'])),original);
  }finally{await fs.rm(f.root,{recursive:true,force:true});}
});

test('active Korea/repair jobs veto starting this UI transaction, while CI does not; no token follows an artifact redirect',async()=>{
  const reader=(active,terminal=true)=>({async json(endpoint){if(endpoint==='/actions/runs/45104426224')return {id:45104426224,status:terminal?'completed':'in_progress',repository:{full_name:'jeep-jim/AvtoCena'}};
    const rows=endpoint.includes('status=in_progress')?active:[];return {total_count:rows.length,workflow_runs:rows};}});
  await assertPublicationQuiescence(reader([{id:9,path:'.github/workflows/ci.yml'}]),'8');
  await assert.rejects(assertPublicationQuiescence(reader([],false),'8'),/korea_recovery_active/);
  await assert.rejects(assertPublicationQuiescence(reader([{id:9,path:'.github/workflows/regcloud-prices.yml'}]),'8'),/other_workflow_active/);
  const requests=[];
  const client=githubReader({token:'synthetic-private-token',fetchImpl:async(url,options)=>{
    requests.push({url:String(url),options});if(requests.length===1)return {status:302,headers:new Headers({location:'https://fixture.blob.core.windows.net/receipt'})};
    return {ok:true,arrayBuffer:async()=>Buffer.from('safe')};
  }});
  await client.archive(123);assert.equal(requests[1].options.headers,undefined);
  assert.ok(requests[0].options.headers.Authorization.includes('synthetic-private-token'));
});

test('browser receipt requires actual command exit, exact release and the frozen speed guard',()=>{
  const value={release:HOME_UI.source,phase:'release-required-browser-gate',passed:true,browserPassed:true,speedGuard:{passed:true}};
  assert.equal(browserVerdict({raw:JSON.stringify(value),exitCode:0,nonce}).passed,true);
  assert.equal(browserVerdict({raw:JSON.stringify(value),exitCode:1,nonce}).passed,false);
  value.speedGuard.passed=false;assert.equal(browserVerdict({raw:JSON.stringify(value),exitCode:0,nonce}).passed,false);
});

test('waiting runner verifies an immutable approval ZIP, its run tuple and exact workflow/helper Git blobs',async()=>{
  const f=await fixture();try{
    const code=['.github/workflows/home-ui-plan-approval.yml','.github/operations/home-ui-activation-20261123/profile.mjs','scripts/lib/readonly-marker-invocation.mjs'];
    for(const filename of code){await fs.mkdir(path.dirname(path.join(f.root,filename)),{recursive:true});await fs.writeFile(path.join(f.root,filename),'synthetic frozen controller\n');}
    git(f.root,['add','.']);git(f.root,['commit','-qm','controller']);const parent=git(f.root,['rev-parse','HEAD']);
    const receipt={runId:'123',createdAt:'2026-11-23T10:00:00Z',plan:{nonce},planSha256:'b'.repeat(64)};
    await fs.mkdir(path.dirname(path.join(f.root,APPROVAL_MARKER)),{recursive:true});
    await fs.writeFile(path.join(f.root,APPROVAL_MARKER),JSON.stringify({version:1,approvedSourceSha:parent,
      operation:approvalOperation({runId:receipt.runId,nonce,planSha256:receipt.planSha256})}));
    git(f.root,['add','.']);git(f.root,['commit','-qm','approve']);const head=git(f.root,['rev-parse','HEAD']);git(f.root,['remote','add','origin',f.root]);
    const run={id:999,status:'completed',conclusion:'success',path:code[0],event:'push',head_branch:'main',head_sha:head,run_attempt:1,
      repository:{full_name:'jeep-jim/AvtoCena'},created_at:'2026-11-23T10:01:00Z'};
    const value={version:1,status:'verified_exact_home_plan_marker',runId:receipt.runId,nonce,planSha256:receipt.planSha256,
      sourceSha:head,approvedSourceSha:parent,approvalRunId:'999',approvalRunAttempt:1};
    const zip=execFileSync('python3',['-I','-B','-c',"import io,sys,zipfile;b=io.BytesIO();z=zipfile.ZipFile(b,'w');z.writestr('approval.json',sys.stdin.buffer.read());z.close();sys.stdout.buffer.write(b.getvalue())"],{input:JSON.stringify(value)});
    let corrupt=false;
    const reader={archive:async()=>corrupt?Buffer.from('corrupt'):zip,async json(endpoint){
      if(endpoint.includes('/workflows/'))return {workflow_runs:[run]};
      assert.equal(endpoint,'/actions/runs/999/artifacts?per_page=100');
      return {total_count:1,artifacts:[{id:777,name:'home-ui-plan-approval-safe-receipt',expired:false,size_in_bytes:zip.length,
        workflow_run:{id:999,head_sha:head},digest:'sha256:'+sha256(zip)}]};
    }};
    assert.equal((await findPlanApproval(reader,f.root,receipt)).planSha256,receipt.planSha256);
    assert.equal(await findPlanApproval(reader,f.root,{...receipt,runId:'124'}),null);
    corrupt=true;await assert.rejects(findPlanApproval(reader,f.root,receipt),/artifact_digest/);
  }finally{await fs.rm(f.root,{recursive:true,force:true});}
});

test('workflow exposes only safe plan/outcome artifacts and gates SSH after the exact plan handoff',async()=>{
  const workflow=await fs.readFile(path.join(root,'.github/workflows/home-ui-activation.yml'),'utf8');
  assert.ok(workflow.indexOf('home-ui-activation-safe-plan')<workflow.indexOf('SSH_PRIVATE_KEY:'));
  assert.ok(workflow.includes('timeout-minutes: 90'));assert.ok(workflow.includes('actions: read'));
  assert.equal(workflow.includes('actions: write'),false);assert.equal(/path:.*(?:image\.tar|calculation-v1)/.test(workflow),false);
  const approval=await fs.readFile(path.join(root,'.github/workflows/home-ui-plan-approval.yml'),'utf8');
  assert.equal(approval.includes('secrets.'),false);assert.ok(approval.includes('--record-approval'));
  const ci=await fs.readFile(path.join(root,'.github/workflows/ci.yml'),'utf8');
  for(const testFile of ['home-ui-activation.test.mjs','home-ui-activation-transport.test.mjs','home-ui-host-driver.test.py'])assert.ok(ci.includes(testFile));
});
