import fs from 'node:fs/promises';
import {getJsonStorage} from '../apps/web/lib/data.ts';
import {MARKET_WORKFLOWS,recoveryDecision,transientOperationFailure} from './lib/catalog-recovery-policy.mjs';
const token=process.env.GH_TOKEN,repo=process.env.GITHUB_REPOSITORY;
if(!token||!/^[-\w]+\/[-\w]+$/.test(repo||''))throw Error('missing_github_context');
const storage=getJsonStorage(),report={checkedAt:new Date().toISOString(),markets:{}};
async function api(path,method='GET',body){
 const response=await fetch(`https://api.github.com/repos/${repo}/${path}`,{method,headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(60000)});
 if(!response.ok)throw Error(`github_${method}_${response.status}`);
 return response.status===204?null:response.json();
}
for(const [market,workflow] of Object.entries(MARKET_WORKFLOWS)){
 try{
 const [data,journal,japan,dispatch]=await Promise.all([
  api(`actions/workflows/${workflow}/runs?branch=main&per_page=10`),
  storage.readJson(`catalog/operations/markets/${market}.json`,null),
  market==='japan'?storage.readJson('catalog/collector-state/proauctions/current.json',null):null,
  storage.readJson(`catalog/operations/recovery/${market}.json`,null),
 ]);
 const decision=recoveryDecision({market,runs:data.workflow_runs,journal,japan,lastDispatchAt:dispatch?.at,recovery:dispatch});
 if(decision.action==='inspect_failure'){
  const jobs=await api(`actions/runs/${decision.runId}/jobs?per_page=100`);
  const failures=jobs.jobs.filter(j=>['failure','timed_out'].includes(j.conclusion));
  let retryable=failures.length>0;
  for(const job of failures){
   const r=await fetch(`https://api.github.com/repos/${repo}/actions/jobs/${job.id}/logs`,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(60000)});
   if(!r.ok){retryable=false;break;}
   const log=await r.text();
   if(!transientOperationFailure(log.slice(-4*1024*1024))){retryable=false;break;}
  }
  if(retryable){await api(`actions/runs/${decision.runId}/rerun-failed-jobs`,'POST');decision.action='rerun_failed';}
  else {decision.action='none';decision.reason='deterministic_or_unclassified_failure';}
 }
 if(decision.action==='dispatch')await api(`actions/workflows/${workflow}/dispatches`,'POST',{ref:'main'});
 if(['dispatch','rerun_failed'].includes(decision.action))await storage.writeJson(`catalog/operations/recovery/${market}.json`,{at:new Date().toISOString(),...decision});
 if(['deterministic_or_unclassified_failure','retry_limit_reached','source_retry_limit_reached','source_failure_requires_attention','old_failed_run_requires_new_schedule'].includes(decision.reason))process.exitCode=1;
 report.markets[market]=decision;
 }catch(e){report.markets[market]={action:'none',error:String(e.message)};process.exitCode=1;}
}
await fs.writeFile('catalog-autonomy-watchdog.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
