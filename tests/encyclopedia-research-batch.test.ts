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
test('a later research batch retains prior field sources',()=>{
 const first=planModelResearch(current,[entry],batch).record;
 const e={...entry,expectedDigest:digest(first.variants[0]),patch:{engineCode:'E123'},confirmedFields:['engineCode']};
 const second=planModelResearch(first,[e],{...batch,id:'research-second'}).record;
 assert.equal(second.variants[0].researchEvidenceHistory[0].batchId,'research-test');
 assert.equal(second.variants[0].researchEvidenceHistory[0].values.batteryKwh,81);
 assert.equal(second.variants[0].researchEvidence.values.engineCode,'E123');
});
test('literal translation changes display text without promoting an observed specification',()=>{
 const observed={...v,transmission:'电动车单速变速箱'};
 const e={...entry,expectedDigest:digest(observed),patch:{transmission:'Одноступенчатый редуктор'},confirmedFields:[],translations:{transmission:{from:observed.transmission}},source:{...entry.source,type:'observation_translation'}};
 validateBatch({...batch,entries:[e]});const result=planModelResearch({...current,variants:[observed]},[e],batch);
 assert.equal(result.record.variants[0].transmission,'Одноступенчатый редуктор');
 assert.deepEqual(result.record.variants[0].researchEvidence.values,{});
 assert.deepEqual(result.record.variants[0].researchEvidence.fields,[]);
 assert.throws(()=>validateBatch({...batch,entries:[{...e,confirmedFields:['transmission']}]}));
 assert.throws(()=>validateBatch({...batch,entries:[{...e,patch:{transmission:'automatic'}}]}));
});

test('review snapshots owner-approved observations but never fabricates reference provenance',()=>{
 const china={...v,markets:['china'],engineCc:1998,power30MinKw:88};
 const e={...entry,expectedDigest:digest(china)};
 const row=planModelResearch({...current,variants:[china]},[e],batch).record.variants[0];
 assert.deepEqual(row.researchEvidence.ownerReferenceSnapshot.markets,['china']);
 assert.equal(row.researchEvidence.ownerReferenceSnapshot.values.engineCc,1998);
 assert.equal(row.researchEvidence.ownerReferenceSnapshot.values.power30MinKw,undefined);
 const uae={...china,markets:['uae']};
 assert.equal(planModelResearch({...current,variants:[uae]},[{...e,expectedDigest:digest(uae)}],batch).record.variants[0].researchEvidence.ownerReferenceSnapshot,undefined);
});

test('historical manufacturer variants are appended with revision protection and replay safety',()=>{
 const e={...entry,operation:'create',variantId:'historical-2008',year:2008,trim:'2.4 S',expectedRevision:current.revision,expectedDigest:digest(null),patch:{trim:'2.4 S',chassisCode:'RR1',engineCc:2354},confirmedFields:['trim','chassisCode','engineCc']};
 const b={...batch,entries:[e]};validateBatch(b);
 const first=planModelResearch(current,[e],b);assert.equal(first.changes.length,1);assert.deepEqual(first.record.variants[0],v);assert.equal(first.record.variants[1].year,2008);
 assert.equal(first.record.variants[1].researchEvidence.ownerReferenceSnapshot,undefined);
 assert.equal(planModelResearch(first.record,[e],b).changes.length,0);
 assert.equal(planModelResearch({...current,revision:'concurrent-edit'},[e],b).changes.length,0);
 const duplicate={...e,variantId:'different-id',expectedRevision:first.record.revision};assert.equal(planModelResearch(first.record,[duplicate],b).skipped[0].reason,'duplicate_variant_identity');
 assert.throws(()=>validateBatch({...b,entries:[{...e,year:2007}]}));
 assert.throws(()=>validateBatch({...b,entries:[{...e,source:{...e.source,type:'observation_translation'}}]}));
 assert.throws(()=>validateBatch({...b,entries:[{...e,confirmedFields:['engineCc']}]}));
});
