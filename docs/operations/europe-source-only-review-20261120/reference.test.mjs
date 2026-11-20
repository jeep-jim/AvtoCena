import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {europeReferencedGenerationIds,rehearseEuropeAppendReferences,planEuropeAppendReferences} from './europe-public-reference-retention.mjs';
import {planRegRetention} from './exact/reg-retention-plan.mjs';

const stamp='2026-11-20T00:00:00.000Z';
const base='gen_1794878284419_base', next='gen_1795132800000_append', after='gen_1795136400000_after', orphan='gen_1794500000000_orphan';
const chunk=(g,i,market='europe')=>'catalog/generations/'+g+'/offers/'+market+'/chunk-'+String(i).padStart(4,'0')+'.json';
const korea={updatedAt:stamp,count:2,chunks:['chunk-0001']};
const old={version:2,generationId:base,markets:{europe:{count:38964,updatedAt:stamp,chunks:Array.from({length:78},(_,i)=>'chunk-'+String(i+1).padStart(4,'0'))},korea}};
const bytes=Buffer.from(JSON.stringify(old));
const sha=x=>createHash('sha256').update(x).digest('hex');
const pins={baseSha:sha(bytes),generation:base,originalCount:38964,originalChunks:78,limitAdditions:1510};
const row={key:chunk(next,1),count:5,sha256:'1'.repeat(64)};
const input={market:'europe',source:'autoscout_europe_open',baseManifestBytes:bytes,nextId:next,rowsForAdditions:[row]};
test('all 78 immutable old full-card references preserved, target-only descriptor, no writer capability',()=>{
 const x=rehearseEuropeAppendReferences(input,pins);
 assert.equal(x.inheritedCardChunkCount,78);assert.equal(x.descriptor.count,38969);
 assert.deepEqual(x.descriptor.chunks,[...Array.from({length:78},(_,i)=>chunk(base,i+1)),chunk(next,1)]);
 assert.deepEqual(x.protectedGenerationIds,[base,next]);assert.equal(x.readyToActivate,false);
 assert.equal(x.noGlobalManifestBuilt,true);assert.equal(x.cloudWrites,0);assert.equal(x.fullSiblingReadModelsVerified,false);
 assert.deepEqual(old.markets.korea,korea);
 assert.throws(()=>planEuropeAppendReferences(input),/baseline_wire_commitment_drift/);
});
test('foreign publisher, malformed inherited path, reused candidate path, duplicate legacy path and oversized row refuse',()=>{
 for(const alt of [{source:'mobile_de_open'},{market:'korea'}])assert.throws(()=>rehearseEuropeAppendReferences({...input,...alt},pins),/scope/);
 for(const alt of [{key:chunk(base,1)},{key:chunk(next,1,'korea')},{count:501},{sha256:'x'}]){
  assert.throws(()=>rehearseEuropeAppendReferences({...input,rowsForAdditions:[{...row,...alt}]},pins),/unbound_candidate_chunk/);
 }
 let x={...old,markets:{europe:{count:3,chunks:['catalog/generations/'+base+'/offers/korea/chunk-0001.json']}}};
 assert.throws(()=>europeReferencedGenerationIds(x),/malformed_or_foreign_europe_chunk_reference/);
 x={...old,markets:{europe:{count:500,chunks:['chunk-0001',chunk(base,1)]}}};
 assert.throws(()=>europeReferencedGenerationIds(x),/duplicate_europe_chunk_reference/);
});
test('installed Reg retention keeps oldest inherited root even after it is only referenced by previous pointer',()=>{
 const requested=rehearseEuropeAppendReferences(input,pins);
 const previousManifest={version:2,generationId:next,markets:{europe:requested.descriptor}};
 const publicManifest={version:2,generationId:after,markets:{europe:{count:1,chunks:['chunk-0001']}}};
 const rows=[...requested.descriptor.chunks,chunk(after,1),chunk(orphan,1)].map(key=>({key,size:100,lastModified:'2026-11-10T00:00:00.000Z'}));
 const result=planRegRetention({publicManifest,previousManifest,internalManifest:{generationId:after,sources:{}},generationObjects:rows,
   internalObjects:[],now:Date.parse('2026-11-25T00:00:00Z'),graceMs:86400000});
 assert.deepEqual(result.selected.map(x=>x.key),[chunk(orphan,1)]);
 assert.ok(result.summary.protectedGenerations.includes(base));
 assert.deepEqual([...europeReferencedGenerationIds(publicManifest,previousManifest)].sort(),[base,next,after].sort());
 assert.throws(()=>planRegRetention({publicManifest,previousManifest,internalManifest:{generationId:after,sources:{}},
  generationObjects:rows.filter(x=>x.key!==chunk(base,4)),internalObjects:[],now:Date.parse('2026-11-25T00:00:00Z')}),/missing_or_invalid_public_chunk/);
});
