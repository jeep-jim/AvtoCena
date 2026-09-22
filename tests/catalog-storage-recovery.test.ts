import test from 'node:test';import assert from 'node:assert/strict';
import {storageBlockedInputBytes,storagePressureRecovery} from '../scripts/lib/catalog-storage-recovery.mjs';
test('storage retries require reserve, otherwise request bounded safe cleanup',()=>{
 const now=Date.parse('2026-09-22T07:00:00Z');
 const input={currentBytes:42_194_162_968,inputBytes:1_068_548_199,now};
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
