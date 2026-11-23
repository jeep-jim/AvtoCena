import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {verifyReadonlyInvocation} from './readonly-marker-invocation.mjs';

export function preparedChinaTrigger(env,event){
 const run=event?.workflow_run;
 assert(env.GITHUB_EVENT_NAME==='workflow_run' && env.GITHUB_REPOSITORY==='jeep-jim/AvtoCena' &&
  env.GITHUB_REPOSITORY_ID==='1289722938' && env.GITHUB_REF==='refs/heads/main' &&
  env.GITHUB_RUN_ATTEMPT==='1' && /^[0-9a-f]{40}$/.test(env.GITHUB_SHA),'invalid staging invocation');
 assert(event.action==='completed' && event.repository?.id===1289722938 &&
  run?.repository?.id===1289722938 && run.head_repository?.id===1289722938 &&
  run.head_branch==='main' && run.path==='.github/workflows/catalog-prepare-owned-china.yml' &&
  run.status==='completed' && run.conclusion==='success' && ['workflow_run','workflow_dispatch','push'].includes(run.event) &&
  Number.isSafeInteger(run.id) && run.id>0 && Number.isSafeInteger(run.run_attempt) && run.run_attempt>0 &&
  /^[0-9a-f]{40}$/.test(run.head_sha),'unverified China preparation');
 return {runId:String(run.id),attempt:String(run.run_attempt),revision:run.head_sha};
}

export function verifyChinaStageInvocation(root,env=process.env){
 if(env.GITHUB_EVENT_NAME!=='workflow_run')return verifyReadonlyInvocation({root,env,
  markerPath:'.github/market-runs/stage-owned-china.json',operation:'prepare-owned-china-private-generation'});
 const producer=preparedChinaTrigger(env,JSON.parse(readFileSync(env.GITHUB_EVENT_PATH,'utf8')));
 assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),env.GITHUB_SHA);
 execFileSync('git',['diff','--quiet','HEAD','--'],{cwd:root});
 return {version:1,event:'workflow_run',sourceSha:env.GITHUB_SHA,producer};
}

export function currentPreparedRun(head,producer){
 assert(head?.version===1 && head.market==='china' &&
  /^catalog\/nonjp-intake\/v1\/china\/[1-9]\d{0,19}\/[1-9]\d{0,5}$/.test(head.archiveRoot) &&
  /^[a-f0-9]{64}$/.test(head.archiveSha256),'current prepared archive unavailable');
 return head.archiveRoot==='catalog/nonjp-intake/v1/china/'+producer.runId+'/'+producer.attempt;
}
