import test from 'node:test';
import assert from 'node:assert/strict';
import {preparedChinaTrigger,currentPreparedRun} from '../scripts/lib/owned-china-stage-invocation.mjs';

const sha='a'.repeat(40);
const env={GITHUB_EVENT_NAME:'workflow_run',GITHUB_REPOSITORY:'jeep-jim/AvtoCena',GITHUB_REPOSITORY_ID:'1289722938',
 GITHUB_REF:'refs/heads/main',GITHUB_RUN_ATTEMPT:'1',GITHUB_SHA:sha};
const repo={id:1289722938};
const run={id:21,run_attempt:2,head_sha:sha,status:'completed',conclusion:'success',head_branch:'main',
 event:'workflow_run',repository:repo,head_repository:repo,path:'.github/workflows/catalog-prepare-owned-china.yml'};
const event={action:'completed',repository:repo,workflow_run:run};
const head={version:1,market:'china',archiveRoot:'catalog/nonjp-intake/v1/china/21/2',archiveSha256:'b'.repeat(64)};
test('daily private staging consumes only the archive from the actual completed preparation and attempt',()=>{
 const producer=preparedChinaTrigger(env,event);
 assert.deepEqual(producer,{runId:'21',attempt:'2',revision:sha});
 assert.equal(currentPreparedRun(head,producer),true);
 for(const archiveRoot of ['catalog/nonjp-intake/v1/china/21/1','catalog/nonjp-intake/v1/china/20/2','catalog/nonjp-intake/v1/china/22/1'])
  assert.equal(currentPreparedRun({...head,archiveRoot},producer),false);
 assert.throws(()=>currentPreparedRun({...head,archiveSha256:''},producer));
});
test('a failed, foreign or unrelated preparation cannot request a generation',()=>{
 for(const patch of [{conclusion:'failure'},{status:'in_progress'},{path:'.github/workflows/catalog-refresh-china.yml'},
  {head_repository:{id:9}},{head_branch:'topic'},{event:'pull_request'},{run_attempt:0},{head_sha:'wrong'}])
  assert.throws(()=>preparedChinaTrigger(env,{...event,workflow_run:{...run,...patch}}));
 assert.throws(()=>preparedChinaTrigger({...env,GITHUB_REPOSITORY_ID:'44'},event));
});
