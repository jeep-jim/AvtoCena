import assert from 'node:assert/strict';
import test from 'node:test';
import {verifyRepairLiveJapan} from '../scripts/lib/catalog-repair-live-japan.mjs';
const releaseSha='a'.repeat(40),now=Date.parse('2026-10-24T17:20:00Z');
const good={ok:true,observedAt:new Date(now).toISOString(),total:600,items:Array.from({length:5},(_,i)=>({id:`ajes-stats-${i}`,market:'japan'})),partial:false,stale:false};
function fixture(page:any,changed=false){let healthCalls=0;return async(url:string)=>({ok:true,status:200,json:async()=>url.includes('/health')?{ok:true,catalogProjectionParts:'scoped-v1',releaseSha:changed&&healthCalls++?'b'.repeat(40):releaseSha}:page});}
test('separate live Japan ownership requires fresh nonempty bounded AJES results on one release',async()=>{
 const proof=await verifyRepairLiveJapan(fixture(good),releaseSha,now);
 assert.equal(proof.total,600);assert.equal(proof.sampled,5);assert.equal(proof.owner,'ajes_japan_feed');
});
test('cached counts, stale/partial pages, wrong identity, empty/duplicate samples and release drift fail closed',async()=>{
 for(const page of [{...good,total:null,countSummary:{total:615131},items:[],partial:true,stale:true},
 {...good,partial:true},{...good,stale:true},{...good,countSummary:{stale:true}},
 {...good,observedAt:new Date(now-16*60000).toISOString()},{...good,items:[]},
 {...good,items:Array(5).fill(good.items[0])},{...good,items:good.items.map(r=>({...r,market:'korea'}))},
 {...good,items:good.items.map(r=>({...r,id:'legacy-'+r.id}))}])
 await assert.rejects(verifyRepairLiveJapan(fixture(page),releaseSha,now),/unverified/);
 await assert.rejects(verifyRepairLiveJapan(fixture(good,true),releaseSha,now),/release_changed/);
 await assert.rejects(verifyRepairLiveJapan(async()=>({ok:false,status:503})),/health_failed/);
});
