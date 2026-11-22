import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import test from 'node:test';

const workflow=fs.readFileSync('.github/workflows/retry-prepared-encar.yml','utf8');
const match=workflow.match(/node --input-type=module <<'VERIFY_PREPARED_ENCAR_RETRY'\n([\s\S]*?)\n\s+VERIFY_PREPARED_ENCAR_RETRY/);
assert.ok(match,'The workflow must contain its executable preflight');
const program=match[1];
const waitMatch=workflow.match(/node --input-type=module <<'WAIT_CURRENT_UAE_WRITER'\n([\s\S]*?)\n\s+WAIT_CURRENT_UAE_WRITER/);
assert.ok(waitMatch,'The workflow must contain its executable writer wait');
const waitProgram=waitMatch[1];
test('public acceptance runs only after the publisher and preserves its failure result',()=>{
  const job=workflow.slice(workflow.indexOf('  verify_public:'));
  assert.match(job,/needs: publish/);
  assert.match(job,/if: needs\.publish\.result == 'success'/);
  assert.match(job,/node scripts\/verify-korea-public-characteristics\.mjs \| tee korea-public-characteristics\.json/);
  assert.match(job,/if: always\(\)/);
  assert.match(job,/if-no-files-found: error/);
  assert.doesNotMatch(job,/continue-on-error|\|\| true|secrets:|API_KEY/);
});
const markerPath='.github/market-runs/korea-prepared-retry.json';
const repository='jeep-jim/AvtoCena', repositoryId=1289722938;
const api='https://api.github.com/repos/'+repository;
const triggerSha='a'.repeat(40), approvedSha='b'.repeat(40);
const sourceSha='c6859fc4658759b60c3ed38709bf9de0e95c041c';
const preparedRun=45002244430, failedRun=45004098806, artifactId=14747335552;
const urls={
  commit:api+'/commits/'+triggerSha,
  prepared:api+'/actions/runs/'+preparedRun,
  failed:api+'/actions/runs/'+failedRun,
  artifact:api+'/actions/artifacts/'+artifactId,
  health:'https://avtocena.com/api/health',
  catalog:'https://avtocena.com/api/catalog/search?market=korea&source=existing&page=1&pageSize=1',
};

function fixture() {
  const run=(id,workflow,event,conclusion)=>({id,run_attempt:1,path:workflow,event,
    head_branch:'main',head_sha:sourceSha,status:'completed',conclusion,
    repository:{id:repositoryId},head_repository:{id:repositoryId}});
  return {
    marker:{version:1,operation:'retry-prepared-encar-45002244430',approvedSourceSha:approvedSha},
    env:{GITHUB_REPOSITORY:repository,GITHUB_REPOSITORY_ID:String(repositoryId),
      GITHUB_REF:'refs/heads/main',GITHUB_EVENT_NAME:'push',GITHUB_SHA:triggerSha,GH_TOKEN:'test-only-token'},
    responses:{
      [urls.commit]:{sha:triggerSha,parents:[{sha:approvedSha}],files:[{filename:markerPath,status:'added'}]},
      [urls.prepared]:run(preparedRun,'.github/workflows/prepare-paid-encar-intake.yml','push','success'),
      [urls.failed]:run(failedRun,'.github/workflows/publish-prepared-encar.yml','workflow_run','failure'),
      [urls.artifact]:{id:artifactId,name:'catalog-intake-korea',expired:false,
        digest:'sha256:a68b622760549b03db92dfb5e34b32c9bbad551f98a55de87f55d0a5c3b49799',
        workflow_run:{id:preparedRun,repository_id:repositoryId,head_repository_id:repositoryId,
          head_branch:'main',head_sha:sourceSha}},
      [urls.health]:{ok:true,releaseSha:'22867cbcfaee27b2e8917b6bf880e44827f67b60',
        calculationVersion:'4654386ca34f04041effe31f38259d0fae9c396ecda35c364e3a18dd125a4b90'},
      [urls.catalog]:{ok:true,generationId:'gen_1794878284419_a611dfcf'},
    },
  };
}

function execute(data) {
  // The marker exists only in an isolated temporary directory, never in the repository.
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'encar-retry-guard-'));
  try {
    fs.mkdirSync(path.join(directory,'.github/market-runs'),{recursive:true});
    fs.writeFileSync(path.join(directory,markerPath),JSON.stringify(data.marker));
    const output=path.join(directory,'output');
    const mock=[
      'const responses='+JSON.stringify(data.responses)+';',
      'const httpStatus='+JSON.stringify(data.httpStatus||{})+';',
      'globalThis.fetch=async (url,options)=>{',
      ' if(!Object.hasOwn(responses,url))throw Error("unexpected_network_request");',
      ' if(options.method && options.method!=="GET")throw Error("network_write_forbidden");',
      ' if(url.startsWith("https://avtocena.com/") && options.headers.authorization)throw Error("token_leak");',
      ' return new Response(JSON.stringify(responses[url]),{status:httpStatus[url]||200});',
      '};',
    ].join('\n');
    const result=spawnSync(process.execPath,['--input-type=module'],{
      input:mock+'\n'+program,cwd:directory,env:{...process.env,...data.env,GITHUB_OUTPUT:output},
      encoding:'utf8',timeout:10000,maxBuffer:128*1024,
    });
    const values=fs.existsSync(output)?Object.fromEntries(fs.readFileSync(output,'utf8')
      .trim().split('\n').map(line=>line.split('='))):{};
    return {...result,verified:values.verified};
  } finally {
    fs.rmSync(directory,{recursive:true,force:true});
  }
}

test('retry has one main push marker, shared Korea serialization and only the prepared publisher',()=>{
  assert.equal(workflow.match(/on:\n([\s\S]*?)\npermissions:/)[1],
    "  push:\n    branches: [main]\n    paths: ['"+markerPath+"']");
  assert.match(workflow,/permissions:\n  contents: read\n  actions: read/);
  assert.match(workflow,/group: catalog-refresh-korea\n  cancel-in-progress: false/);
  assert.match(workflow,/verified: \$\{\{ steps\.verify\.outputs\.verified \|\| 'false' \}\}/);
  const waitJob=workflow.slice(workflow.indexOf('\n  wait_current_writer:'),workflow.indexOf('\n  publish:'));
  assert.match(waitJob,/needs: verify\n    if: needs\.verify\.result == 'success' && needs\.verify\.outputs\.verified == 'true'/);
  assert.match(waitJob,/timeout-minutes: 130/);
  assert.doesNotMatch(waitJob,/secrets:|environment:|YC_OBJECT_STORAGE|\/cancel|import-lock/);
  const publishJob=workflow.slice(workflow.indexOf('\n  publish:'));
  assert.match(publishJob,/needs: \[verify, wait_current_writer\]/);
  assert.match(publishJob,/if: needs\.verify\.result == 'success' && needs\.verify\.outputs\.verified == 'true' && needs\.wait_current_writer\.result == 'success' && needs\.wait_current_writer\.outputs\.completed == 'true'/);
  assert.match(workflow,/uses: \.\/\.github\/workflows\/catalog-market-refresh\.yml/);
  assert.match(workflow,/market: korea\n      prepared_encar_run: '45002244430'\n      prepared_encar_self: false/);
  assert.doesNotMatch(workflow,/workflow_dispatch:|schedule:|workflow_run:|collect_initial:|catalog-paid-encar-refresh|AUTO_API_|actions: write|contents: write/);
});

test('actual retry preflight accepts the exact approved parent and unchanged saved/live identities',()=>{
  const result=execute(fixture());
  assert.equal(result.status,0,result.stderr);
  assert.equal(result.verified,'true');
  const report=JSON.parse(result.stdout.trim());
  assert.equal(report.approvedSourceSha,approvedSha);
  assert.equal(report.preparedRun,preparedRun);
  assert.equal(report.failedRun,failedRun);
  assert.equal(report.supplierRequests,0);
});

test('actual retry preflight refuses unreviewed code, changed source identity and changed live state',()=>{
  const cases=[
    ['wrong ref',d=>{d.env.GITHUB_REF='refs/heads/other';},'retry_event_invalid'],
    ['marker overlay',d=>{d.marker.refreshMarkets=['korea'];},'retry_marker_invalid'],
    ['wrong parent',d=>{d.responses[urls.commit].parents[0].sha='c'.repeat(40);},'retry_source_parent_changed'],
    ['merge commit',d=>{d.responses[urls.commit].parents.push({sha:'c'.repeat(40)});},'retry_source_parent_changed'],
    ['code changed with marker',d=>{d.responses[urls.commit].files.push({filename:'scripts/publisher.mjs',status:'modified'});},'retry_code_changed'],
    ['marker renamed',d=>{d.responses[urls.commit].files[0].status='renamed';},'retry_code_changed'],
    ['prepared still running',d=>{d.responses[urls.prepared].status='in_progress';},'retry_run_state_'+preparedRun],
    ['prepared rerun',d=>{d.responses[urls.prepared].run_attempt=2;},'retry_run_identity_'+preparedRun],
    ['prepared different source',d=>{d.responses[urls.prepared].head_sha='c'.repeat(40);},'retry_run_identity_'+preparedRun],
    ['failed run now successful',d=>{d.responses[urls.failed].conclusion='success';},'retry_run_state_'+failedRun],
    ['failed run another repository',d=>{d.responses[urls.failed].head_repository.id=1;},'retry_run_identity_'+failedRun],
    ['artifact expired',d=>{d.responses[urls.artifact].expired=true;},'retry_artifact_changed'],
    ['artifact replaced',d=>{d.responses[urls.artifact].id++;},'retry_artifact_changed'],
    ['artifact digest changed',d=>{d.responses[urls.artifact].digest='sha256:'+'0'.repeat(64);},'retry_artifact_changed'],
    ['artifact foreign run',d=>{d.responses[urls.artifact].workflow_run.id=failedRun;},'retry_artifact_changed'],
    ['release changed',d=>{d.responses[urls.health].releaseSha='d'.repeat(40);},'retry_live_release_changed'],
    ['calculator changed',d=>{d.responses[urls.health].calculationVersion='d'.repeat(64);},'retry_live_calculation_changed'],
    ['generation changed',d=>{d.responses[urls.catalog].generationId='gen_new';},'retry_live_generation_changed'],
    ['health unavailable',d=>{d.httpStatus={[urls.health]:503};},'retry_live_health_http_503'],
  ];
  for(const [label,mutate,error] of cases) {
    const data=fixture();mutate(data);
    const result=execute(data);
    assert.equal(result.status,1,label+': '+result.stderr);
    assert.equal(result.verified,'false',label);
    assert.ok(result.stderr.includes(error),label+': '+result.stderr);
  }
});

function writer(status='in_progress') {
  return {id:44990370917,run_attempt:2,head_sha:'7209465ad5d00ab4ed1a1c2c24114eddc5a58ff6',
    path:'.github/workflows/catalog-refresh-uae.yml',head_branch:'main',status,
    conclusion:status==='completed'?'failure':null,
    repository:{id:repositoryId},head_repository:{id:repositoryId}};
}

function executeWait(runs,{readDuration=0}={}) {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'encar-writer-wait-'));
  try {
    const output=path.join(directory,'output'), clock=path.join(directory,'clock.json');
    const mock=[
      "import {writeFileSync as saveWaitClock} from 'node:fs';",
      'const runs='+JSON.stringify(runs)+';',
      'let now=0,reads=0;const delays=[];',
      'Date.now=()=>now;',
      'globalThis.setTimeout=(callback,delay)=>{delays.push(delay);now+=delay;callback();return 0;};',
      'globalThis.fetch=async (url,options)=>{',
      ' if(url!=="https://api.github.com/repos/jeep-jim/AvtoCena/actions/runs/44990370917")throw Error("unexpected_network_request");',
      ' if(options.method!=="GET")throw Error("network_write_forbidden");',
      ' const run=runs[Math.min(reads++,runs.length-1)];',
      ' now+='+readDuration+';',
      ' return new Response(JSON.stringify(run),{status:200});',
      '};',
      'process.on("exit",()=>saveWaitClock(process.env.WAIT_TEST_CLOCK,JSON.stringify({now,reads,delays})));',
    ].join('\n');
    const result=spawnSync(process.execPath,['--input-type=module'],{
      input:mock+'\n'+waitProgram,cwd:directory,
      env:{...process.env,GITHUB_OUTPUT:output,WAIT_TEST_CLOCK:clock,GH_TOKEN:'test-only-token'},
      encoding:'utf8',timeout:10000,maxBuffer:128*1024,
    });
    const values=Object.fromEntries(fs.readFileSync(output,'utf8').trim().split('\n').map(line=>line.split('=')));
    return {...result,completed:values.completed,clock:JSON.parse(fs.readFileSync(clock,'utf8')),
      logs:result.stdout.trim()?result.stdout.trim().split('\n').map(line=>JSON.parse(line)):[]};
  } finally {
    fs.rmSync(directory,{recursive:true,force:true});
  }
}

test('writer wait accepts an already terminal exact UAE attempt without sleeping',()=>{
  const result=executeWait([writer('completed')]);
  assert.equal(result.status,0,result.stderr);
  assert.equal(result.completed,'true');
  assert.deepEqual(result.clock,{now:0,reads:1,delays:[]});
  assert.deepEqual(result.logs,[{status:'completed',polls:1}]);
});

test('writer wait polls busy to terminal with 30-second backoff and bounded status-only logs',()=>{
  const result=executeWait([writer(),writer(),writer('completed')]);
  assert.equal(result.status,0,result.stderr);
  assert.equal(result.completed,'true');
  assert.deepEqual(result.clock,{now:60000,reads:3,delays:[30000,30000]});
  assert.deepEqual(result.logs,[{status:'in_progress',polls:1},{status:'in_progress',polls:2},{status:'completed',polls:3}]);
});

test('writer wait revalidates ownership, attempt and code identity on every read',()=>{
  const changes=[
    r=>{r.id++;},r=>{r.run_attempt++;},r=>{r.head_sha='c'.repeat(40);},
    r=>{r.path='.github/workflows/other.yml';},r=>{r.head_branch='other';},
    r=>{r.repository.id=1;},r=>{r.head_repository.id=1;},
  ];
  for(const change of changes) {
    const changed=writer('completed');change(changed);
    const result=executeWait([writer(),changed]);
    assert.equal(result.status,1,result.stderr);
    assert.equal(result.completed,'false');
    assert.match(result.stderr,/uae_wait_identity_changed/);
    assert.deepEqual(result.clock,{now:30000,reads:2,delays:[30000]});
  }
});

test('writer wait fails closed at 120 minutes instead of spinning or starting publication',()=>{
  const result=executeWait([writer()]);
  assert.equal(result.status,1,result.stderr);
  assert.equal(result.completed,'false');
  assert.match(result.stderr,/uae_wait_deadline/);
  assert.equal(result.clock.now,120*60*1000);
  assert.equal(result.clock.reads,240);
  assert.equal(result.clock.delays.length,240);
  assert.ok(result.clock.delays.every(delay=>delay===30000));
});

test('writer wait refuses a terminal response received after its deadline',()=>{
  const result=executeWait([writer('completed')],{readDuration:120*60*1000+1});
  assert.equal(result.status,1,result.stderr);
  assert.equal(result.completed,'false');
  assert.match(result.stderr,/uae_wait_deadline/);
  assert.equal(result.clock.reads,1);
  assert.deepEqual(result.clock.delays,[]);
});
