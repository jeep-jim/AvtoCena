import test from 'node:test';
import assert from 'node:assert/strict';
import {ARCHIVE_MANIFESTS,capturePredecessor,samePredecessor,compareMembership,verifyLocal,stage} from './stage.mjs';
const manifest='catalog/manifest.json',cursor='catalog/intake-cursors/v1/uae.json';
const g='gen_1794878284419_a611dfcf', g2='gen_1794878284420_b611dfcf', now=Date.parse('2026-11-21T02:00:00Z');
const chunk='catalog/generations/'+g+'/offers/uae/chunk-0001.json';
const releaseSha='22867cbcfaee27b2e8917b6bf880e44827f67b60',calculationVersion='4654386ca34f04041effe31f38259d0fae9c396ecda35c364e3a18dd125a4b90';
const id=n=>String(n).padStart(24,'a'), write=v=>Buffer.from(JSON.stringify(v)), sourceId='dubicars_uae_exact';
function fixture(){
 const holder={version:2,generationId:g,markets:{uae:{count:2,updatedAt:'2026-11-17T01:18:04.419Z',chunks:[chunk]}}};
 const signed={version:1,market:'uae',generationId:g,sources:[{sourceId,provider:'auto_api_dubicars',cursor:320763,stopReason:'source_finished'}],
 durableIntakeArchive:{root:'catalog/nonjp-intake/v1/uae/43988535521/1',manifestSha256:ARCHIVE_MANIFESTS[0][1]}};
 const rows=[{id:id(1),market:'uae',sourceId,catalogPricingMode:'seller',totalRub:1000000},{id:id(2),market:'uae',sourceId,totalRub:2000000}];
 const io={read:async k=>write(k===manifest?holder:k===cursor?signed:k===chunk?rows:{version:1}),create:async()=>assert.fail('no write permitted')};
 return {holder,signed,rows,io};
}
test('foreign shared generation only okay for unchanged concrete UAE refs',async()=>{
 const f=fixture(), first=await capturePredecessor(f.io);
 f.holder.generationId=g2;assert.ok(samePredecessor(first,await capturePredecessor(f.io)));
 f.holder.generationId=g;f.holder.markets.uae.chunks=['chunk-0001'];
 const relative=await capturePredecessor(f.io);
 f.holder.generationId=g2;assert.ok(!samePredecessor(relative,await capturePredecessor(f.io)));
});
test('a different watched cursor or cross-market refs fails closed',async()=>{
 const f=fixture();f.signed.sources[0].cursor=324989;
 await assert.rejects(capturePredecessor(f.io),/predecessor_not_exact_base/);
 f.signed.sources[0].cursor=320763;f.holder.markets.uae.chunks=[chunk.replace('/uae/','/china/')];
 await assert.rejects(capturePredecessor(f.io),/chunk_path/);
});
test('complete membership without asserting missing as sold or seller as delivered',async()=>{
 const f=fixture(), a=await capturePredecessor(f.io);
 assert.deepEqual(await compareMembership(f.io,a,new Map([[id(1),{}],[id(3),{}]])),{
 sourceOverlap:1,archiveOnly:1,liveOnly:1,livePositiveDelivered:1,livePositiveDeliveredMissingSource:1,
 liveOtherSource:0,liveUnverifiedSource:0,exactActiveMembershipCompared:true,saleOrAvailabilityInferred:false,priceOrPhotoParityVerified:false});
 f.rows[1].id=id(1);await assert.rejects(compareMembership(f.io,a,new Map()),/row_membership/);
});
test('an expired source stops even before checking health or data',async()=>{
 const forbidden=async()=>assert.fail('expired archive must not read live or stage');
 await assert.rejects(stage({io:{read:forbidden,create:forbidden},clock:()=>Date.parse('2026-11-21T23:40:39.128Z'),runId:'44853116983',
 localDir:'/path/unused',expectedHealth:{releaseSha,calculationVersion},getHealth:forbidden,assertOwner:forbidden}),/outside_review_horizon/);
});
test('real exact archive verifies; changed durable archive pin blocks all writes',{skip:!process.env.UAE_LOCAL_EXACT},async()=>{
 const verified=await verifyLocal(process.env.UAE_LOCAL_EXACT);
 assert.equal(verified.ids.size,27581);assert.equal(verified.chunks.length,57);
 const f=fixture();await assert.rejects(stage({io:f.io,clock:()=>now,runId:'44853116983',localDir:process.env.UAE_LOCAL_EXACT,
 expectedHealth:{releaseSha,calculationVersion},getHealth:async()=>({ok:true,releaseSha,calculationVersion}),
 assertOwner:async()=> 'uae-owner-on'}),/durable_archive_pin/);
});
