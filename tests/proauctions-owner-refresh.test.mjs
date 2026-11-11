import test from 'node:test';
import assert from 'node:assert/strict';
import {proAuctionsSchedule} from '../scripts/lib/proauctions-schedule.mjs';
test('explicit refresh starts fresh completed inventory but preserves unfinished checkpoints',()=>{
 const now=Date.parse('2026-10-06T05:00:00Z');
 const state={startedAt:'2026-10-05T05:00:00Z',complete:true,published:true};
 assert.equal(proAuctionsSchedule(state,now,14).due,false);
 assert.deepEqual(proAuctionsSchedule(state,now,14,true),{due:true,resume:false,reason:'owner_requested_refresh'});
 assert.equal(proAuctionsSchedule({...state,complete:false},now,14,true).resume,true);
 assert.equal(proAuctionsSchedule({...state,published:false},now,14,true).reason,'retry_publication');
});
