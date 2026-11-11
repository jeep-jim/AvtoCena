import test from 'node:test';
import assert from 'node:assert/strict';
import {assertCancelledRepairOwner,releaseCancelledRepairLock} from '../scripts/lib/release-cancelled-repair-lock.mjs';
const operationId='read-model-repair-bb3d8336-0f92-4122-8422-acc813eff059';
const lock={operationId,operationType:'catalog_read_model_repair',startedAt:'2026-10-24T15:42:48.889Z',lockedUntil:'2026-10-24T17:22:48.889Z'};
const run={id:40108157776,run_attempt:1,status:'completed',conclusion:'cancelled',path:'.github/workflows/catalog-current-read-models.yml',repository:{full_name:'jeep-jim/AvtoCena'}};
const jobs=[{name:'refresh',run_id:run.id,run_attempt:1,status:'completed',conclusion:'cancelled',steps:[{name:'Publish one-hop projections and offer shards',started_at:'2026-10-24T15:42:47Z',completed_at:'2026-10-24T15:54:41Z',conclusion:'cancelled'}]}];
test('only the exact confirmed cancelled repair lease is released and read back',async()=>{
 let record={...lock};let writes=0;
 const result=await releaseCancelledRepairLock({storage:{readJson:async()=>record},mutate:async(_,__,change)=>{record=change(record);writes++;},expectedOperationId:operationId,run,jobs});
 assert.equal(result.released,true);assert.equal(writes,1);assert.equal(record.lockedUntil,'');assert.equal(record.operationId,operationId);
});
test('running, wrong owner, changed lease and unrelated execution windows are refused',async()=>{
 assert.throws(()=>assertCancelledRepairOwner(lock,operationId,{...run,status:'in_progress'},jobs),/not_cancelled/);
 assert.throws(()=>assertCancelledRepairOwner({...lock,operationId:'other'},operationId,run,jobs),/owner_mismatch/);
 assert.throws(()=>assertCancelledRepairOwner({...lock,startedAt:'2026-10-24T16:00:00Z'},operationId,run,jobs),/not_owned/);
 assert.throws(()=>assertCancelledRepairOwner(lock,operationId,run,[{...jobs[0],run_attempt:2}]),/job_not_cancelled/);
 let touched=false;
 await assert.rejects(releaseCancelledRepairLock({storage:{readJson:async()=>lock},mutate:async(_,__,change)=>{change({...lock,lockedUntil:'changed'});touched=true;},expectedOperationId:operationId,run,jobs}),/lock_changed/);
 assert.equal(touched,false);
});
