import test from 'node:test';
import assert from 'node:assert/strict';
import {digest,validateBatch,planModelResearch} from '../scripts/encyclopedia/research-batch.mjs';
const v={id:'v1',trim:'EV Max',year:2026,status:'observed',powerHp:300,markets:['china']};
const current={id:'a'.repeat(24),make:'Example',model:'Car',revision:'r1',variants:[v],photo:'keep'};
const entry={modelId:current.id,variantId:v.id,make:current.make,model:current.model,year:2026,trim:v.trim,expectedDigest:digest(v),patch:{batteryKwh:81},confirmedFields:['batteryKwh'],source:{type:'manufacturer',url:'https://example.com/spec',checkedAt:'2026-10-21',statement:'Battery capacity 81 kWh; certified 30-minute power not supplied.'}};
const batch={version:1,id:'research-test',entries:[entry]};
test('only reviewed fields change; observations never become verified facts',()=>{
 validateBatch(batch);const result=planModelResearch(current,[entry],batch);
 assert.equal(result.record.variants[0].batteryKwh,81);assert.equal(result.record.variants[0].powerHp,300);
 assert.equal(result.record.variants[0].status,'review');assert.deepEqual(result.record.variants[0].researchEvidence.fields,['batteryKwh']);
 assert.equal(result.record.photo,'keep');assert.equal(v.status,'observed');assert.equal(result.record.variants[0].power30MinKw,undefined);
});
test('concurrent field edits and wrong year or model cannot be overwritten',()=>{
 for(const changed of [{...v,powerHp:301},{...v,year:2025},{...v,trim:'EV Ultra'}]){
  const result=planModelResearch({...current,variants:[changed]},[entry],batch);assert.equal(result.changes.length,0);assert.equal(result.record.variants[0],changed);
 }
 assert.equal(planModelResearch({...current,make:'Other'},[entry],batch).changes.length,0);
});
test('rerunning a completed batch is idempotent and retains the revision',()=>{
 const first=planModelResearch(current,[entry],batch),second=planModelResearch(first.record,[entry],batch);
 assert.equal(second.changes.length,0);assert.equal(second.record.revision,first.record.revision);
 assert.equal(second.skipped[0].reason,'already_applied');
});
test('reject undocumented 30-minute power, non-technical writes, untranslated patch and duplicate entries',()=>{
 for(const patch of [{power30MinKw:81},{status:'verified'},{trim:'增程'}])assert.throws(()=>validateBatch({...batch,entries:[{...entry,patch,confirmedFields:Object.keys(patch)}]}));
 assert.throws(()=>validateBatch({...batch,entries:[entry,entry]}));
 assert.equal(digest({a:1,b:2}),digest({b:2,a:1}));
});
