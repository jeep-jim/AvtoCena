import {recoveryDecision} from '../scripts/lib/catalog-recovery-policy.mjs';
import test from 'node:test';import assert from 'node:assert/strict';
import {storageBlockedInputBytes,storagePressureRecovery} from '../scripts/lib/catalog-storage-recovery.mjs';
test('storage retries require reserve, otherwise request bounded safe cleanup',()=>{
 const now=Date.parse('2026-09-22T07:00:00Z');
 const input={currentBytes:52_194_162_968,inputBytes:1_068_548_199,now};
 assert.equal(storagePressureRecovery(input).action,'cleanup');
 assert.equal(storagePressureRecovery({...input,currentBytes:28_000_000_000}).action,'retry');
 assert.equal(storagePressureRecovery({...input,cleanupRunning:true}).action,'wait');
 assert.equal(storagePressureRecovery({...input,recovery:{storageCleanupRequestedAt:new Date(now-60000).toISOString()}}).action,'wait');
 assert.equal(storagePressureRecovery({...input,recovery:{storageWindowStartedAt:new Date(now-60000).toISOString(),storageCleanupAttempts:3}}).reason,'storage_pressure_requires_attention');
});
test('only the actual blocked preflight report supplies the retry estimate',()=>{
 assert.equal(storageBlockedInputBytes('Object Storage reserve insufficient\n{"inputBytes":1068548199,"ok":false}'),1068548199);
 assert.equal(storageBlockedInputBytes('Object Storage reserve insufficient'),null);
 assert.equal(storageBlockedInputBytes('{"inputBytes":1068548199,"ok":false}'),null);
});

test('cleanup completion can recheck reserve immediately without bypassing retry cooldown',()=>{
 const now=Date.parse('2026-09-22T08:00:00Z');
 const input={market:'europe',now,runs:[{id:7,status:'completed',conclusion:'failure',run_attempt:1,updated_at:'2026-09-22T07:00:00Z'}],lastDispatchAt:'2026-09-22T07:59:00Z'};
 assert.equal(recoveryDecision({...input,recovery:{action:'cleanup_dispatched'}}).action,'inspect_failure');
 assert.equal(recoveryDecision({...input,recovery:{action:'rerun_failed'}}).reason,'dispatch_cooldown');
});
