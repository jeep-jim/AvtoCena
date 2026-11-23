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
const sourceSha='c90dea655470d2970f5f22cc7d7f98c086874738';
const preparedRun=45077320093, producerJobId=137403171884, artifactId=14779553850;
const artifactDigest='9dafe4744cfaef0522f564978dc38152e28d52d55790fcd6a7d03a670a7d4aeb';
const urls={
  commit:api+'/commits/'+triggerSha,
  prepared:api+'/actions/runs/'+preparedRun,
  producer:api+'/actions/jobs/'+producerJobId,
  artifact:api+'/actions/artifacts/'+artifactId,
  health:'https://avtocena.com/api/health',
  catalog:'https://avtocena.com/api/catalog/search?market=korea&source=existing&page=1&pageSize=1',
};

function fixture() {
  const run=(id,workflow,event,conclusion)=>({id,run_attempt:1,path:workflow,event,
    head_branch:'main',head_sha:sourceSha,status:'completed',conclusion,
    repository:{id:repositoryId},head_repository:{id:repositoryId}});
  return {
    marker:{version:1,operation:'retry-prepared-encar-45077320093-1',approvedSourceSha:approvedSha},
    now:Date.parse('2026-11-23T02:35:00Z'),
    env:{GITHUB_REPOSITORY:repository,GITHUB_REPOSITORY_ID:String(repositoryId),
      GITHUB_REF:'refs/heads/main',GITHUB_EVENT_NAME:'push',GITHUB_SHA:triggerSha,GH_TOKEN:'test-only-token'},
    responses:{
      [urls.commit]:{sha:triggerSha,parents:[{sha:approvedSha}],files:[{filename:markerPath,status:'added'}]},
      [urls.prepared]:run(preparedRun,'.github/workflows/catalog-refresh-korea.yml','schedule','failure'),
      [urls.producer]:{id:producerJobId,run_id:preparedRun,run_attempt:1,head_sha:sourceSha,head_branch:'main',
        name:'refresh / prepare',workflow_name:'Catalog refresh korea',status:'completed',conclusion:'success',
        started_at:'2026-11-22T23:52:08Z',completed_at:'2026-11-23T00:12:18Z',
        steps:[
          [5,'Verify this completed snapshot and current CRM before restoration'],
          [6,'Restore paid listings and prepare their saved history and inspection'],
          [7,'Run actions/upload-artifact@v4'],
          [8,'Bind the prepared artifact to the successful producer attempt'],
        ].map(([number,name])=>({number,name,status:'completed',conclusion:'success'}))},
      [urls.artifact]:{id:artifactId,name:'catalog-intake-korea-45077320093-1',expired:false,
        digest:'sha256:'+artifactDigest,size_in_bytes:26217418,
        created_at:'2026-11-23T00:12:16Z',updated_at:'2026-11-23T00:12:16Z',expires_at:'2026-11-26T00:12:12Z',
        url:api+'/actions/artifacts/'+artifactId,archive_download_url:api+'/actions/artifacts/'+artifactId+'/zip',
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
      'Date.now=()=>'+data.now+';',
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
  assert.doesNotMatch(workflow,/wait_current_writer|WAIT_CURRENT_UAE_WRITER|44990370917/);
  const publishJob=workflow.slice(workflow.indexOf('\n  publish:'),workflow.indexOf('\n  verify_public:'));
  assert.match(publishJob,/needs: verify/);
  assert.match(publishJob,/if: needs\.verify\.result == 'success' && needs\.verify\.outputs\.verified == 'true'/);
  assert.match(workflow,/uses: \.\/\.github\/workflows\/catalog-market-refresh\.yml/);
  assert.match(publishJob,/market: korea\n      prepared_encar_run: '45077320093'\n      prepared_encar_self: false/);
  assert.ok(publishJob.includes("prepared_encar_source_sha: '"+sourceSha+"'"));
  assert.match(publishJob,/prepared_encar_attempt: '1'/);
  assert.ok(publishJob.includes("prepared_encar_artifact_id: '"+artifactId+"'"));
  assert.ok(publishJob.includes("prepared_encar_artifact_digest: '"+artifactDigest+"'"));
  assert.doesNotMatch(workflow,/workflow_dispatch:|schedule:|workflow_run:|collect_initial:|catalog-paid-encar-refresh|AUTO_API_|actions: write|contents: write/);
});

test('actual retry preflight accepts the exact approved parent and unchanged saved/live identities',()=>{
  const result=execute(fixture());
  assert.equal(result.status,0,result.stderr);
  assert.equal(result.verified,'true');
  const report=JSON.parse(result.stdout.trim());
  assert.equal(report.approvedSourceSha,approvedSha);
  assert.equal(report.preparedRun,preparedRun);
  assert.equal(report.preparedAttempt,1);
  assert.equal(report.producerJobId,producerJobId);
  assert.equal(report.artifactId,artifactId);
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
    ['failed run now successful',d=>{d.responses[urls.prepared].conclusion='success';},'retry_run_state_'+preparedRun],
    ['failed run another repository',d=>{d.responses[urls.prepared].head_repository.id=1;},'retry_run_identity_'+preparedRun],
    ['run different workflow',d=>{d.responses[urls.prepared].path='.github/workflows/other.yml';},'retry_run_identity_'+preparedRun],
    ['run different event',d=>{d.responses[urls.prepared].event='push';},'retry_run_identity_'+preparedRun],
    ['run different branch',d=>{d.responses[urls.prepared].head_branch='other';},'retry_run_identity_'+preparedRun],
    ['artifact expired',d=>{d.responses[urls.artifact].expired=true;},'retry_artifact_changed'],
    ['artifact replaced',d=>{d.responses[urls.artifact].id++;},'retry_artifact_changed'],
    ['artifact digest changed',d=>{d.responses[urls.artifact].digest='sha256:'+'0'.repeat(64);},'retry_artifact_changed'],
    ['artifact foreign run',d=>{d.responses[urls.artifact].workflow_run.id=45002244430;},'retry_artifact_changed'],
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

test('a failed parent run is reusable only with the exact successful preparation job and all completion steps',()=>{
  const changes=[
    p=>{p.id++;},p=>{p.run_id++;},p=>{p.run_attempt++;},p=>{p.head_sha='c'.repeat(40);},
    p=>{p.head_branch='other';},p=>{p.name='refresh / collect';},p=>{p.workflow_name='Other workflow';},
    p=>{p.status='in_progress';},p=>{p.conclusion='failure';},
    p=>{p.started_at='2026-11-22T23:52:09Z';},p=>{p.completed_at=null;},
    ...[0,1,2,3].map(index=>p=>{p.steps[index].conclusion='skipped';}),
    p=>{p.steps[2].name='actions/upload-artifact@v4';},
    p=>{p.steps.pop();},p=>{p.steps.push({...p.steps[3]});},
  ];
  for(const change of changes) {
    const data=fixture();change(data.responses[urls.producer]);
    const result=execute(data);
    assert.equal(result.status,1,result.stderr);
    assert.equal(result.verified,'false');
    assert.match(result.stderr,/retry_producer_(job_identity|job_state|job_time|step_)/);
  }
});

test('artifact size, name, timestamps, download identity and source ownership remain exact',()=>{
  const changes=[
    a=>{a.name='catalog-intake-korea';},a=>{a.size_in_bytes++;},a=>{a.created_at='2026-11-23T00:12:17Z';},
    a=>{a.updated_at='2026-11-23T00:12:17Z';},a=>{a.expires_at='2026-11-27T00:12:12Z';},
    a=>{a.url+='1';},a=>{a.archive_download_url='https://example.test/archive';},
    a=>{a.workflow_run.repository_id=1;},a=>{a.workflow_run.head_repository_id=1;},
    a=>{a.workflow_run.head_sha='d'.repeat(40);},a=>{a.workflow_run.head_branch='other';},
  ];
  for(const change of changes) {
    const data=fixture();change(data.responses[urls.artifact]);
    const result=execute(data);
    assert.equal(result.status,1,result.stderr);
    assert.equal(result.verified,'false');
    assert.match(result.stderr,/retry_artifact_changed/);
  }
  const expired=fixture();expired.now=Date.parse(expired.responses[urls.artifact].expires_at);
  const result=execute(expired);
  assert.equal(result.status,1,result.stderr);
  assert.equal(result.verified,'false');
  assert.match(result.stderr,/retry_artifact_changed/);
});
