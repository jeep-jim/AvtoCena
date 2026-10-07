import test from 'node:test';
import assert from 'node:assert/strict';
import {recoveryDecision,transientOperationFailure} from '../scripts/lib/catalog-recovery-policy.mjs';
const now=Date.parse('2026-09-22T12:00:00Z');
const input={market:'korea',now,runs:[],journal:{lastCollectionSuccess:'2026-09-22T09:00:00Z'}};
test('recovery isolates active markets and enforces cooldown and retry limits',()=>{
 assert.equal(recoveryDecision({...input,runs:[{status:'in_progress'}]}).reason,'already_running');
 const failed={id:42,status:'completed',conclusion:'failure',run_attempt:1,updated_at:'2026-09-22T11:00:00Z'};
 assert.equal(recoveryDecision({...input,runs:[failed]}).action,'inspect_failure');
 assert.equal(recoveryDecision({...input,runs:[{...failed,run_attempt:3}]}).action,'none');
 assert.equal(recoveryDecision({...input,runs:[failed],lastDispatchAt:'2026-09-22T11:00:00Z'}).action,'none');
 assert.equal(recoveryDecision({...input,runs:[{...failed,conclusion:'cancelled'}]}).reason,'respect_cancellation');
});
test('stale source observations trigger recovery even when publication timestamps are fresh',()=>{
 assert.equal(recoveryDecision(input).action,'none');
 assert.equal(recoveryDecision({...input,journal:{lastCollectionSuccess:'2026-09-15T00:00:00Z',lastPublicationSuccess:'2026-09-22T11:00:00Z'}}).action,'dispatch');
 assert.equal(recoveryDecision({...input,market:'japan',japan:{complete:false}}).reason,'resume_incomplete_checkpoint');
});
test('only transient failures retry; bad data, denied source access and safety gates remain stopped',()=>{
 for(const error of ['object_storage_GET_unreachable:fetch failed','ETIMEDOUT','transport_error_checkpointed']) assert.equal(transientOperationFailure(error),true,error);
 for(const error of ['catalog_public_regression_guard:korea','checkpoint_part_checksum_mismatch','source_access_refused','source_access_403','syntax error','catalog_publish_base_changed']) assert.equal(transientOperationFailure(error),false,error);
});

test('successful partial publications cannot hide broken sources; transient retries are bounded',()=>{
 const journal={...input.journal,sources:[{sourceId:'encar',stopReason:'list_failed',errors:[{message:'network timeout'}]}]};
 const decision=recoveryDecision({...input,journal});
 assert.equal(decision.action,'dispatch');assert.equal(decision.sourceAttempts,1);
 assert.equal(recoveryDecision({...input,journal,recovery:{windowStartedAt:new Date(now-3600000).toISOString(),sourceAttempts:3}}).reason,'source_retry_limit_reached');
 assert.equal(recoveryDecision({...input,journal:{...journal,sources:[{sourceId:'encar',stopReason:'blocked'}]}}).reason,'source_failure_requires_attention');
 assert.equal(recoveryDecision({...input,journal:{...journal,sources:[{sourceId:'encar',stopReason:'time_budget'}]}}).action,'none');
});

test('a successful no-op schedule cannot hide a missing collection journal',()=>{
 assert.equal(recoveryDecision({...input,journal:null,runs:[{status:'completed',conclusion:'success'}]}).reason,'missing_or_stale_collection');
});

test('published China budget slices continue automatically with matching committed cursors',()=>{
 const sources=[{sourceId:'che168',stopReason:'budget',cursor:'2001'}];
 const journal={publicationStatus:'published',generationId:'g',runId:'42',sources};
 const intakeCheckpoint={version:1,market:'china',generationId:'g',updatedAt:new Date(now).toISOString(),sources};
 const args={...input,market:'china',journal,intakeCheckpoint,runs:[{id:42,status:'completed',conclusion:'failure',updated_at:new Date(now-3600000).toISOString()}]};
 const result=recoveryDecision(args);
 assert.equal(recoveryDecision({...args,market:'europe',intakeCheckpoint:{...intakeCheckpoint,market:'europe'}}).reason,'continue_published_budget_slice');
 assert.equal(result.reason,'continue_published_budget_slice');assert.equal(result.action,'dispatch');
 assert.equal(recoveryDecision({...args,recovery:result}).reason,'budget_continuation_no_progress');
 const advanced=[{...sources[0],cursor:'4001'}];
 assert.equal(recoveryDecision({...args,journal:{...journal,generationId:'g2',sources:advanced},intakeCheckpoint:{...intakeCheckpoint,generationId:'g2',sources:advanced},recovery:result}).action,'dispatch');
 assert.equal(recoveryDecision({...args,journal:{...journal,generationId:'g2'},intakeCheckpoint:{...intakeCheckpoint,generationId:'g2'},recovery:result}).reason,'budget_continuation_no_progress');
 assert.equal(recoveryDecision({...args,recovery:{budgetWindowStartedAt:new Date(now-3600000).toISOString(),budgetAttempts:2}}).action,'dispatch');
 assert.equal(recoveryDecision({...args,lastDispatchAt:new Date(now-3600000).toISOString()}).reason,'dispatch_cooldown');
 for(const change of [
  {journal:{...journal,publicationStatus:'failed'}},
  {intakeCheckpoint:{...intakeCheckpoint,generationId:'wrong'}},
  {intakeCheckpoint:{...intakeCheckpoint,sources:[{...sources[0],cursor:'999'}]}},
  {intakeCheckpoint:{...intakeCheckpoint,updatedAt:new Date(now-5*86400000).toISOString()}},
  {journal:{...journal,sources:[...sources,{sourceId:'other',stopReason:'blocked'}]}},
  {runs:[{id:43,status:'completed',conclusion:'failure',updated_at:new Date(now-3600000).toISOString()}]},
  {runs:[{id:42,status:'completed',conclusion:'cancelled'}]},
 ])assert.notEqual(recoveryDecision({...args,...change}).action,'dispatch',JSON.stringify(change));
});

test('a legacy published slice is proven by the active market projection and committed cursor',()=>{
 const sources=[{sourceId:'che168',stopReason:'budget',cursor:'2001'}];
 const journal={publicationStatus:'failed',generationId:'g',runId:'42',sources};
 const intakeCheckpoint={version:1,market:'china',generationId:'g',updatedAt:new Date(now).toISOString(),sources};
 const args={...input,market:'china',journal,intakeCheckpoint,activeMarket:{count:28382,updatedAt:new Date(now-30000).toISOString()},runs:[{id:42,status:'completed',conclusion:'failure',updated_at:new Date(now-3600000).toISOString()}]};
 assert.equal(recoveryDecision(args).reason,'continue_published_budget_slice');
 assert.equal(recoveryDecision({...args,activeMarket:{count:28382,updatedAt:new Date(now-16*60000).toISOString()}}).action,'dispatch');
 for(const activeMarket of [
  undefined,
  {count:0,updatedAt:new Date(now-30000).toISOString()},
 ])assert.notEqual(recoveryDecision({...args,activeMarket}).action,'dispatch',JSON.stringify(activeMarket));
});

test('a blocked budget continuation is reported instead of being called current',()=>{
 const sources=[{sourceId:'che168',stopReason:'budget',cursor:'2001'}];
 const journal={publicationStatus:'published',generationId:'g',sources,lastCollectionSuccess:new Date(now).toISOString()};
 const result=recoveryDecision({...input,market:'china',journal,intakeCheckpoint:null,runs:[{status:'completed',conclusion:'success'}]});
 assert.equal(result.reason,'budget_continuation_blocked');
 assert.deepEqual(result.blockers,['checkpoint_missing_or_invalid','checkpoint_generation_mismatch','checkpoint_stale','cursor_not_committed']);
});

test('Japan watchdog shares the collector schedule instead of relying on a missing generic journal',()=>{
 const japan={startedAt:new Date(now-86400000).toISOString(),complete:true,published:true};
 const args={...input,market:'japan',journal:null,japan};
 assert.equal(recoveryDecision(args).action,'none');
 assert.equal(recoveryDecision({...args,now:now+3*86400000}).action,'none');
 assert.equal(recoveryDecision({...args,now:now+14*86400000}).reason,'refresh_interval');
 assert.equal(recoveryDecision({...args,japan:{...japan,published:false}}).reason,'retry_publication');
 assert.equal(recoveryDecision({...args,japanRefreshIntervalDays:14,now:now+4*86400000}).action,'none');
});

test('a completed China tail restarts on the refresh interval without claiming full cycle coverage',()=>{
 const journal={collectionComplete:false,lastCollectionAttempt:new Date(now-3*86400000).toISOString(),sources:[{sourceId:'che168',initialCursor:'2001',stopReason:'source_finished'}]};
 const args={...input,market:'china',journal};
 assert.equal(recoveryDecision(args).reason,'refresh_completed_continuation');
 assert.equal(recoveryDecision({...args,now:now-1}).action,'none');
 assert.equal(recoveryDecision({...args,runs:[{status:'in_progress'}]}).reason,'already_running');
});


test('all five intake markets resume a proven published transport slice before failed-job replay',()=>{
 for(const market of ['china','europe','korea','uae','georgia']){
 const sources=[{sourceId:'primary',cursor:'192',stopReason:'list_failed',retryableTransportFailure:true},{sourceId:'secondary',cursor:'2001',stopReason:'budget'}];
 const journal={publicationStatus:'published',generationId:'g',runId:42,sources};
 const intakeCheckpoint={version:1,market,generationId:'g',updatedAt:new Date(now).toISOString(),sources};
 const args={...input,market,journal,intakeCheckpoint,runs:[{id:42,status:'completed',conclusion:'failure',run_attempt:3,updated_at:new Date(now-3600000).toISOString()}]};
 const decision=recoveryDecision(args);assert.equal(decision.action,'dispatch');assert.equal(decision.reason,'continue_published_transport_slice');
 assert.equal(recoveryDecision({...args,recovery:{...decision,transportAttempts:3}}).reason,'source_retry_limit_reached');
 for(const change of [{intakeCheckpoint:null},{intakeCheckpoint:{...intakeCheckpoint,generationId:'wrong'}},{intakeCheckpoint:{...intakeCheckpoint,sources:[{...sources[0],retryableTransportFailure:false},sources[1]]}},{journal:{...journal,sources:[{...sources[0],stopReason:'blocked'}]}}])assert.notEqual(recoveryDecision({...args,...change}).action,'dispatch');
 const advanced=sources.map(row=>({...row,cursor:row.cursor+'1'}));
 assert.equal(recoveryDecision({...args,journal:{...journal,sources:advanced},intakeCheckpoint:{...intakeCheckpoint,sources:advanced},recovery:{...decision,transportAttempts:3}}).action,'dispatch');
 }
});
