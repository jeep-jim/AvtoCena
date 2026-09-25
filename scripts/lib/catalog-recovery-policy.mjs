import {transientOperationFailure} from './transient-operation.mjs';
export const MARKET_WORKFLOWS=Object.fromEntries(['china','korea','uae','georgia','europe'].map(m=>[m,`catalog-refresh-${m}.yml`]));
MARKET_WORKFLOWS.green='catalog-refresh-green.yml';
MARKET_WORKFLOWS.japan='proauctions-collect-publish.yml';
export function recoveryDecision({market,runs,journal,japan,intakeCheckpoint,activeMarket,now=Date.now(),lastDispatchAt,recovery}) {
 if(!MARKET_WORKFLOWS[market])throw Error('invalid_recovery_market');
 if(runs.some(r=>['queued','in_progress','waiting','pending','requested'].includes(r.status)))return {action:'none',reason:'already_running'};
 if(recovery?.action!=='cleanup_dispatched'&&now-Date.parse(lastDispatchAt||'')<2*3600000)return {action:'none',reason:'dispatch_cooldown'};
 const latest=runs[0];
 if(latest?.conclusion==='cancelled')return {action:'none',reason:'respect_cancellation'};
 // A published slice may end with a non-success workflow solely because its
 // collection is partial. Resume only its committed budget cursor, never
 // rerun the failed publication or advance past observations not published.
 const budgetStops=new Set(['budget','time_budget','budget_mid_page']);
 const sourceRows=journal?.sources||[];
 const budgetRows=sourceRows.filter(s=>budgetStops.has(s.stopReason));
 const checkpointAge=now-Date.parse(intakeCheckpoint?.updatedAt||'');
 // The intake checkpoint is written only after the public manifest commit.
 // Older successful publishers did not yet write publicationStatus to the
 // operations journal, so the exact committed generation and cursors are the
 // publication proof. Another market may later change the global manifest time.
 const legacyPublishedSlice=journal?.publicationStatus!=='published'
  && Number(activeMarket?.count)>0
  && journal?.generationId && journal.generationId===intakeCheckpoint?.generationId;
 const slicePublished=journal?.publicationStatus==='published'||legacyPublishedSlice;
 const budgetContinuationBlockers=[];
 if(!['china','europe'].includes(market))budgetContinuationBlockers.push('market_not_resumable');
 if(!slicePublished)budgetContinuationBlockers.push('slice_not_published');
 if(intakeCheckpoint?.version!==1||intakeCheckpoint?.market!==market)budgetContinuationBlockers.push('checkpoint_missing_or_invalid');
 if(intakeCheckpoint?.generationId!==journal?.generationId)budgetContinuationBlockers.push('checkpoint_generation_mismatch');
 if(!(checkpointAge>=0&&checkpointAge<4*86400000))budgetContinuationBlockers.push('checkpoint_stale');
 if(sourceRows.some(s=>!budgetStops.has(s.stopReason)&&!['source_finished','source_cycle_finished'].includes(s.stopReason)))budgetContinuationBlockers.push('other_source_incomplete');
 if(budgetRows.some(s=>typeof s.cursor!=='string'||!s.cursor.length
   ||!intakeCheckpoint?.sources?.some(c=>c.sourceId===s.sourceId&&c.cursor===s.cursor&&budgetStops.has(c.stopReason))))budgetContinuationBlockers.push('cursor_not_committed');
 if(latest&&latest.conclusion!=='success'&&String(latest.id)!==String(journal?.runId))budgetContinuationBlockers.push('newer_failed_run');
 const committedBudget=['china','europe'].includes(market) && slicePublished
  && intakeCheckpoint?.version===1 && intakeCheckpoint.market===market
  && intakeCheckpoint.generationId===journal.generationId
  && checkpointAge>=0 && checkpointAge<4*86400000 && budgetRows.length>0
  && sourceRows.every(s=>budgetStops.has(s.stopReason)||['source_finished','source_cycle_finished'].includes(s.stopReason))
  && budgetRows.every(s=>typeof s.cursor==='string' && s.cursor.length>0
    && intakeCheckpoint.sources?.some(c=>c.sourceId===s.sourceId && c.cursor===s.cursor && budgetStops.has(c.stopReason)))
  && (!latest || latest.conclusion==='success' || String(latest.id)===String(journal.runId));
 if(committedBudget){
  const active=now-Date.parse(recovery?.budgetWindowStartedAt||'')<86400000;
  const attempts=active?Number(recovery.budgetAttempts||0):0;
  if(attempts>=2)return {action:'none',reason:'budget_continuation_limit_reached'};
  return {action:'dispatch',reason:'continue_published_budget_slice',budgetAttempts:attempts+1,
   budgetWindowStartedAt:active?recovery.budgetWindowStartedAt:new Date(now).toISOString()};
 }
 if(budgetRows.length)return {action:'none',reason:'budget_continuation_blocked',blockers:[...new Set(budgetContinuationBlockers)]};
 if(latest&&['failure','timed_out'].includes(latest.conclusion)){
  if((latest.run_attempt||1)>=3)return {action:'none',reason:'retry_limit_reached'};
  if(now-Date.parse(latest.updated_at)<15*60000)return {action:'none',reason:'failure_cooldown'};
  if(now-Date.parse(latest.updated_at)>24*3600000)return {action:'none',reason:'old_failed_run_requires_new_schedule'};
  return {action:'inspect_failure',runId:latest.id};
 }
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
 const stale=!Number.isFinite(last)||now-last>(market==='japan'?15:4)*86400000;
 if((!latest&&!Number.isFinite(last))||stale)return {action:'dispatch',reason:'missing_or_stale_collection'};
 return {action:'none',reason:'current'};
}
export {transientOperationFailure};
