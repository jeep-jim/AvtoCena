import test, {after, before} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

const source = '7052907fb11d58ff919be11a43747d43df01b41e';
const oldSource = 'd61464a512f1d833a5af49d8a3e3b2ea754e231e';
const controller = 'b'.repeat(40), release = 'c'.repeat(40), calculator = 'd'.repeat(64);
const retired = 43866071844, retiredSha = '46a50cf408291d17ac939eb7b28b5d9bb120e615';
const waitStep = 'Wait read-only for the existing catalog publication';
const planStep = 'Complete read-only plan through the unchanged source helper';
const applyStep = 'Apply the exact reviewed receipt with the same controller';
const workflow = fs.readFileSync(new URL('../.github/workflows/repair-paid-encar-technical.yml', import.meta.url), 'utf8');
const dispatcher = fs.readFileSync(new URL('../.github/workflows/dispatch-paid-encar-technical-once.yml', import.meta.url), 'utf8');
const gateMatch = workflow.match(/<<'REVIEW_GATE'\n([\s\S]*?)          REVIEW_GATE\n/);
const guardMatch = workflow.match(/<<'GUARD'\n([\s\S]*?)          GUARD\n/);
const dispatchMatch = dispatcher.match(/^          script: \|\n((?:            .*\n)*)/m);
assert.ok(gateMatch && guardMatch && dispatchMatch, 'exercise the actual workflow programs');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'paid-repair-review-source-'));
let gate: any;
before(async () => {
  const filename = path.join(directory, 'review-gate.mjs');
  fs.writeFileSync(filename, gateMatch[1].replace(/^          /gm, ''));
  gate = await import(pathToFileURL(filename).href);
});
after(() => fs.rmSync(directory, {recursive:true, force:true}));

function environment() {
  return {GITHUB_REPOSITORY:'jeep-jim/AvtoCena', GITHUB_REF:'refs/heads/main', GITHUB_EVENT_NAME:'workflow_dispatch',
    GITHUB_SHA:controller, GITHUB_RUN_ID:'123456', GITHUB_RUN_ATTEMPT:'1', REVIEW_FOR_APPLY:'true',
    PAID_REPAIR_SOURCE_SHA:source, PAID_REPAIR_CONTROLLER_SHA:controller,
    PAID_REPAIR_EXPECTED_RELEASE:release, PAID_REPAIR_EXPECTED_CALCULATOR:calculator};
}
function dispatchFixture(pinnedSource = source, checkedSource = source, options: Record<string,any> = {}) {
  const sent: any[] = [], cancelled: number[] = [], calls: string[] = [], waits: number[] = [];
  const prior = {id:retired,head_sha:retiredSha,run_attempt:1,head_branch:'main',event:'workflow_dispatch',
    path:'.github/workflows/repair-paid-encar-technical.yml',status:'completed',conclusion:'cancelled',...options.prior};
  const running = prior.status !== 'completed';
  const steps = [
    {name:waitStep,status:running?'in_progress':'completed',conclusion:running?null:'cancelled'},
    {name:planStep,status:running?'pending':'completed',conclusion:running?null:'skipped'},
    {name:applyStep,status:running?'pending':'completed',conclusion:running?null:'skipped'},
  ].map(step => ({...step,...options.steps?.[step.name]}));
  const oldJob = {id:133294841553,run_id:retired,steps,...options.job};
  let branchReads = 0, priorReads = 0;
  const github = {rest:{repos:{async getBranch() {
    calls.push('branch'); return {data:{commit:{sha:options.branchHeads?.[branchReads++] || controller}}};
  }}, actions:{
    async listWorkflowRunsForRepo(args: any) {
      calls.push('checks'); assert.equal(args.head_sha, source);
      return {data:{workflow_runs:['CI','Verify Dubicars paid feed'].map((name,id) =>
        ({name,id,head_sha:checkedSource,status:'completed',conclusion:'success'}))}};
    },
    async getWorkflowRun(args: any) {
      calls.push('prior'); assert.equal(args.run_id,retired);
      return {data:structuredClone(priorReads++ === 0 ? prior : {...prior,status:'completed',conclusion:'cancelled',...options.terminal})};
    },
    async listJobsForWorkflowRun(args: any) {
      calls.push('priorJobs'); assert.equal(args.run_id,retired); assert.equal(args.per_page,100);
      return {data:structuredClone({total_count:1,jobs:[oldJob],...options.jobs})};
    },
    async cancelWorkflowRun(args: any) {
      calls.push('cancel'); assert.equal(args.run_id,retired); cancelled.push(args.run_id);
    },
    async listWorkflowRuns() {calls.push('active'); return {data:{workflow_runs:options.active || []}};},
    async createWorkflowDispatch(args: any) {sent.push(JSON.parse(JSON.stringify(args)));},
  }}};
  return {sent,cancelled,calls,waits,run:() => vm.runInNewContext(`(async () => {\n${dispatchMatch[1].replace(/^            /gm, '')}\n})()`, {
    require(id: string) {assert.equal(id, 'node:assert/strict'); return assert;}, github,
    process:{env:{REPAIR_SOURCE:pinnedSource,REPAIR_RELEASE:release,REPAIR_CALCULATOR:calculator}},
    context:{repo:{owner:'jeep-jim',repo:'AvtoCena'},ref:'refs/heads/main',sha:controller},core:{info() {}},
    setTimeout(fn: () => void, milliseconds: number) {assert.equal(milliseconds,2000); waits.push(milliseconds); fn(); return 0;},
  }, {timeout:1000})};
}

test('both source pins and actual dispatcher bind the preserved same-run review to the new exact checks', async () => {
  assert.equal(gate.SOURCE, source);
  assert.ok(workflow.includes(`PAID_REPAIR_SOURCE_SHA: ${source}`));
  assert.ok(dispatcher.includes(`REPAIR_SOURCE: ${source}`));
  assert.ok(dispatcher.includes(`Review updated saved Korea correction ${source.slice(0,8)} after lease`));
  assert.ok(!workflow.includes(oldSource) && !dispatcher.includes(oldSource));
  const f = dispatchFixture(); await f.run();
  assert.equal(f.cancelled.length,0, 'an already terminal retired run is not cancelled again');
  assert.deepEqual(f.sent, [{owner:'jeep-jim',repo:'AvtoCena',workflow_id:'repair-paid-encar-technical.yml',ref:'main',inputs:{
    controller_sha:controller,expected_release:release,expected_calculator:calculator,review_for_apply:'true',
  }}]);
  const old = dispatchFixture(oldSource); await assert.rejects(old.run());
  assert.equal(old.calls.length, 0); assert.equal(old.sent.length, 0);
  const staleChecks = dispatchFixture(source, oldSource);
  await assert.rejects(staleChecks.run(), /source_check_not_passed/); assert.equal(staleChecks.sent.length, 0);
});

test('actual dispatcher cancels only the exact retired lease waiter and waits for its terminal cancellation', async () => {
  const f = dispatchFixture(source,source,{prior:{status:'in_progress',conclusion:null}});
  await f.run();
  assert.deepEqual(f.cancelled,[retired]); assert.equal(f.sent.length,1);
  assert.equal(f.calls.filter(name => name === 'prior').length,2);
  assert.equal(f.calls.filter(name => name === 'branch').length,2);
  assert.ok(f.calls.indexOf('cancel') < f.calls.lastIndexOf('prior'));
});

test('wrong retired identity, started plan/apply or non-waiting phase never authorizes cancellation or dispatch', async () => {
  for (const options of [
    {prior:{id:43753103164}}, {prior:{head_sha:'f'.repeat(40)}}, {prior:{run_attempt:2}},
    {prior:{head_branch:'other'}}, {prior:{event:'push'}}, {prior:{path:'.github/workflows/other.yml'}},
    {prior:{status:'completed',conclusion:'success'}},
    {job:{id:133294841554}}, {job:{run_id:43753103164}},
    {jobs:{total_count:2}}, {jobs:{jobs:[]}},
    {steps:{[waitStep]:{status:'completed'}}},
    {steps:{[planStep]:{status:'in_progress'}}},
    {steps:{[planStep]:{status:'completed',conclusion:'success'}}},
    {steps:{[applyStep]:{status:'in_progress'}}},
    {steps:{[applyStep]:{status:'completed',conclusion:'success'}}},
  ] as Record<string,any>[]) {
    const f = dispatchFixture(source,source,{...options,prior:{status:'in_progress',conclusion:null,...options.prior}});
    await assert.rejects(f.run());
    assert.equal(f.cancelled.length,0); assert.equal(f.sent.length,0);
  }
});

test('failed retirement polling, changed main or another active repair cannot dispatch a replacement', async () => {
  for (const options of [
    {terminal:{head_sha:'f'.repeat(40)}}, {terminal:{run_attempt:2}},
    {terminal:{conclusion:'failure'}}, {terminal:{status:'in_progress',conclusion:null}},
    {branchHeads:[controller,'f'.repeat(40)]},
    {active:[{id:999,status:'in_progress'}]},
  ] as Record<string,any>[]) {
    const f = dispatchFixture(source,source,{...options,prior:{status:'in_progress',conclusion:null}});
    await assert.rejects(f.run());
    assert.deepEqual(f.cancelled,[retired]); assert.equal(f.sent.length,0);
    assert.ok(f.waits.length <= 20, 'the retirement poll remains bounded');
    if (options.terminal?.status === 'in_progress') assert.equal(f.waits.length,20);
  }
});

test('actual pre-checkout guard rejects the former source and a different controller or ref', () => {
  const run = (overrides: Record<string,string> = {}) => spawnSync(process.execPath, ['--input-type=module','-'], {
    input:guardMatch[1].replace(/^          /gm, ''),encoding:'utf8',timeout:1000,env:{...environment(),...overrides},
  });
  const valid = run(); assert.equal(valid.error, undefined); assert.equal(valid.status, 0, valid.stderr);
  for (const override of [{PAID_REPAIR_SOURCE_SHA:oldSource},{GITHUB_SHA:'f'.repeat(40)},{GITHUB_REF:'refs/heads/other'}]) {
    const invalid = run(override); assert.equal(invalid.error, undefined); assert.notEqual(invalid.status, 0);
  }
});

function evidenceFixture() {
  const now = Date.parse('2026-11-16T12:00:00.000Z'), identity = gate.runIdentity(environment());
  const proof = {count:1,...Object.fromEntries(['idsSha256','rowsSha256','invariantsSha256','commercialSha256',
    'freshnessSha256','mediaSha256','manualSha256','derivedQuotesSha256'].map(key => [key,'e'.repeat(64)]))};
  const core = {version:1,mode:'paid_encar_saved_technical_repair',records:[{id:'fixture'}],before:proof,
    sourceSha:source,controllerSha:controller,liveIdentity:identity.liveIdentity,utcDay:'2026-11-16',policyDay:'2026-11-16',
    generationId:'gen_1794665184205_cfd76b47',manifest:{found:true,etag:'"manifest"',sha256:'1'.repeat(64)},
    sourceProof:{identity:{runId:'43570782014',attempt:'1',producerSha:'6a720ec3aa4823ef2808848018bc5b877fb520ad'},
      rows:1,pages:1,matched:1,observedAt:'2026-11-14T12:00:00.000Z'},outcomes:{technical_corrected:1}};
  const receipt = {core,sha256:gate.digest(core)};
  const summary = {action:'plan',receiptSha256:receipt.sha256,sourceSha:source,controllerSha:controller,
    liveIdentity:identity.liveIdentity,baseGenerationId:core.generationId,currentRows:1,sourceCalls:0,cursorCommit:false,published:false};
  const publication = {market:'korea',dryRun:true,published:false,previousManifestPreserved:true,canonical:1,
    technicalRepair:{verified:true,receiptSha256:receipt.sha256,after:proof,examples:[]},
    freshOfferAudit:{summary:{complete:true,unexplained:0,missingIdObservations:0}}};
  const args = {receipt,summary,publication,identity,now,nonce:'9'.repeat(64)};
  const evidence = gate.createReviewEvidence(args);
  const artifact = {id:'777',name:`paid-encar-technical-plan-${identity.runId}-${identity.attempt}`,sha256:'6'.repeat(64)};
  const approval = {...gate.approvalTemplate(evidence.request,artifact),approvedAt:new Date(now+1000).toISOString()};
  return {...args,...evidence,artifact,approval};
}

test('review evidence binds source705 and cannot adopt a rehashed receipt from the old source', () => {
  const f = evidenceFixture();
  assert.equal(f.request.sourceSha, source); assert.equal(f.request.controllerSha, controller);
  assert.equal(f.request.receiptSha256, f.receipt.sha256); assert.equal(f.request.nonce, f.nonce);
  assert.throws(() => gate.runIdentity({...environment(),PAID_REPAIR_SOURCE_SHA:oldSource}), /review_source_changed/);
  const receipt = structuredClone(f.receipt); receipt.core.sourceSha = oldSource; receipt.sha256 = gate.digest(receipt.core);
  assert.throws(() => gate.createReviewEvidence({...f,receipt}), /review_receipt_identity/);
  assert.equal(gate.assertApproval(f.approval,f.request,f.artifact,f.now+1000), f.receipt.sha256);
  for (const key of ['nonce','receiptSha256','sourceSha','controllerSha']) {
    const approval = structuredClone(f.approval); approval.request[key] = key.endsWith('Sha') ? 'f'.repeat(40) : 'f'.repeat(64);
    assert.throws(() => gate.assertApproval(approval,f.request,f.artifact,f.now+1000), /review_approval_request_changed/);
  }
});

function approvalApi(f: any, approval: any, wrongArtifact = false) {
  const approvedMain = 'a'.repeat(40);
  return async (endpoint: string) => {
    if (endpoint.includes('/actions/runs/')) return {id:f.identity.runId,run_attempt:f.identity.attempt,head_sha:controller,
      head_branch:'main',event:'workflow_dispatch',path:gate.WORKFLOW,status:'in_progress'};
    if (endpoint.includes('/actions/artifacts/')) return {id:f.artifact.id,name:f.artifact.name,expired:false,size_in_bytes:100,
      digest:'sha256:'+(wrongArtifact?'0'.repeat(64):f.artifact.sha256),
      workflow_run:{id:f.identity.runId,head_sha:controller,head_branch:'main'}};
    if (endpoint.endsWith('/git/ref/heads/main')) return {object:{sha:approvedMain}};
    if (endpoint.includes('/compare/')) return {status:'ahead',merge_base_commit:{sha:controller}};
    if (endpoint.includes('/contents/')) {
      if (approval === null) return null;
      const raw = Buffer.from(JSON.stringify(approval));
      return {type:'file',path:f.request.approvalPath,encoding:'base64',size:raw.length,content:raw.toString('base64'),
        sha:createHash('sha1').update(`blob ${raw.length}\0`).update(raw).digest('hex')};
    }
    throw Error('unexpected_api:'+endpoint);
  };
}

test('actual review wait accepts only the exact artifact approval on a descendant main for this same run', async () => {
  const f = evidenceFixture();
  const result = await gate.waitForApproval({request:f.request,artifact:f.artifact,identity:f.identity,
    now:() => f.now+1000,get:approvalApi(f,f.approval),pause:() => {throw Error('unexpected_wait');}});
  assert.equal(result.approvedSha256,f.receipt.sha256); assert.equal(result.commit,'a'.repeat(40));
  const changed = structuredClone(f.approval); changed.request.nonce = '8'.repeat(64);
  await assert.rejects(gate.waitForApproval({request:f.request,artifact:f.artifact,identity:f.identity,
    now:() => f.now+1000,get:approvalApi(f,changed)}), /review_approval_request_changed/);
  await assert.rejects(gate.waitForApproval({request:f.request,artifact:f.artifact,identity:f.identity,
    now:() => f.now+1000,get:approvalApi(f,f.approval,true)}), /review_artifact_changed/);
});

test('missing approval expires without producing an apply receipt; workflow retains the exact review condition', async () => {
  const f = evidenceFixture(); let clock = f.now+1000;
  await assert.rejects(gate.waitForApproval({request:f.request,artifact:f.artifact,identity:f.identity,
    now:() => clock,get:approvalApi(f,null),pause:async () => {clock += gate.REVIEW_MS;}}), /review_window_expired/);
  assert.match(workflow, /if: \$\{\{ inputs\.review_for_apply && steps\.review\.outcome == 'success' \}\}/);
  assert.match(workflow, /PAID_REPAIR_APPROVED_SHA256: \$\{\{ steps\.review\.outputs\.approved_plan_sha256 \}\}/);
  assert.match(workflow, /environment: regcloud-staging/);
  assert.match(workflow, /timeoutMs = 35 \* 60_000/);
});
