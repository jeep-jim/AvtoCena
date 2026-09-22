import {transientOperationFailure} from './transient-operation.mjs';
export const MARKET_WORKFLOWS=Object.fromEntries(['china','korea','uae','georgia','europe'].map(m=>[m,`catalog-refresh-${m}.yml`]));
MARKET_WORKFLOWS.green='catalog-refresh-green.yml';
MARKET_WORKFLOWS.japan='proauctions-collect-publish.yml';
export function recoveryDecision({market,runs,journal,japan,now=Date.now(),lastDispatchAt,recovery}) {
 if(!MARKET_WORKFLOWS[market])throw Error('invalid_recovery_market');
 if(runs.some(r=>['queued','in_progress','waiting','pending','requested'].includes(r.status)))return {action:'none',reason:'already_running'};
 if(recovery?.action!=='cleanup_dispatched'&&now-Date.parse(lastDispatchAt||'')<2*3600000)return {action:'none',reason:'dispatch_cooldown'};
 const latest=runs[0];
 if(latest&&['failure','timed_out'].includes(latest.conclusion)){
  if((latest.run_attempt||1)>=3)return {action:'none',reason:'retry_limit_reached'};
  if(now-Date.parse(latest.updated_at)<15*60000)return {action:'none',reason:'failure_cooldown'};
  if(now-Date.parse(latest.updated_at)>24*3600000)return {action:'none',reason:'old_failed_run_requires_new_schedule'};
  return {action:'inspect_failure',runId:latest.id};
 }
 if(latest?.conclusion==='cancelled')return {action:'none',reason:'respect_cancellation'};
 if(market==='japan'&&japan&&!japan.complete)return {action:'dispatch',reason:'resume_incomplete_checkpoint'};
 const failedSources=(journal?.sources||[]).filter(s=>['list_failed','blocked','blocked_detail','adapter_missing','cursor_loop','repeated_page'].includes(s.stopReason));
 if(failedSources.length){
  const retryable=failedSources.every(s=>s.stopReason==='list_failed'&&(s.errors||[]).some(e=>transientOperationFailure(e.message)));
  if(!retryable)return {action:'none',reason:'source_failure_requires_attention',sources:failedSources.map(s=>s.sourceId)};
  const windowActive=now-Date.parse(recovery?.windowStartedAt||'')<86400000;
  const attempt=windowActive?Number(recovery.sourceAttempts||0):0;
  if(attempt>=3)return {action:'none',reason:'source_retry_limit_reached'};
  return {action:'dispatch',reason:'retry_transient_source_failure',sourceAttempts:attempt+1,windowStartedAt:windowActive?recovery.windowStartedAt:new Date(now).toISOString()};
 }
 const last=Date.parse(journal?.lastCollectionSuccess||journal?.lastPublicationSuccess||'');
 const stale=now-last>(market==='japan'?15:4)*86400000;
 if((!latest&&!Number.isFinite(last))||stale)return {action:'dispatch',reason:'missing_or_stale_collection'};
 return {action:'none',reason:'current'};
}
export {transientOperationFailure};
