import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {rawDigest} from '../scripts/lib/catalog-raw-provenance.mjs';
import {ownedChinaCoverage} from '../scripts/lib/owned-china-active-coverage.mjs';

const sourceId='autohome_used_china_open',snapshotBinding='1'.repeat(64),completedAt='2026-11-23T00:00:00.000Z',cursor=123;
const id=n=>createHash('sha256').update(sourceId+':'+n).digest('hex').slice(0,24);
const offer=n=>({id:id(n),sourceId,sourceOfferId:String(n),status:'active',market:'china',operational:{provider:'auto-api.com',
 detailIdentityVerified:true,che168ActiveVerification:{method:'snapshot_and_complete_change_stream',snapshotBinding,cursor,verifiedAt:completedAt}}});
function make(rows=[offer(1),offer(4)],old=[id(1),id(2),id(3)]){
 return {prepared:{report:{sources:[{cursor,snapshotBinding}],completedAt,confirmedWithdrawals:[{id:id(2)},{id:id(1)}]},
  chunks:async function*(){yield rows;},assertCurrent:async()=>{}},
  witness:{normalized:{rows:2,idsSha256:rawDigest([id(1),id(4)].sort())}},
  incumbentIds:async function*(){yield*old;},incumbent:{rows:old.length,generationId:'retained'}};
}
test('active, explicitly removed, missing and new identities are counted separately',async()=>{
 const r=await ownedChinaCoverage(make());
 assert.deepEqual([r.previouslyPublishedStillInSource,r.previouslyPublishedExplicitlyRemoved,
  r.previouslyPublishedAbsentWithoutRemovalEvent,r.sourceIdsOutsidePublishedInventory],[1,1,1,1]);
});
test('wrong snapshot rows, duplicate IDs and a changed authority refuse the result',async()=>{
 await assert.rejects(ownedChinaCoverage(make([offer(1),offer(1)])),/verification/);
 await assert.rejects(ownedChinaCoverage(make([offer(1),offer(5)])),/active_set/);
 await assert.rejects(ownedChinaCoverage(make(undefined,[id(1),id(1)])),/incumbent_duplicate/);
 const input=make();input.prepared.assertCurrent=async()=>{throw Error('pointer changed');};
 await assert.rejects(ownedChinaCoverage(input),/pointer changed/);
});
