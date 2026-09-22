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
