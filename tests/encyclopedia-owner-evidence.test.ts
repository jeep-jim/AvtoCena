import test from 'node:test';
import assert from 'node:assert/strict';
import {validateBatch,planModelResearch,digest} from '../scripts/encyclopedia/research-batch.mjs';
import {compileModelFacts} from '../apps/web/lib/encyclopedia/calculation-index';
const row={id:'variant',year:2025,trim:'Pro',status:'observed',markets:['china'],fuel:'hybrid',powertrainKind:'other_hybrid',engineCc:1496,powerKw:300};
const model={id:'a'.repeat(24),make:'Li Auto',model:'Li L6',revision:'r1',variants:[row]};
const source={type:'owner_confirmed',url:'https://github.com/jeep-jim/AvtoCena/blob/main/docs/encyclopedia/owner-references/table.json',checkedAt:'2026-10-23',confirmedByOwner:true,attachmentSha256:'a'.repeat(64),tableRow:12,powerEvidenceDocument:'Owner table; not manufacturer certification',statement:'Owner confirmed 30-minute motor power 65+69=134 kW.'};
const entry={modelId:model.id,make:model.make,model:model.model,variantId:row.id,year:row.year,trim:row.trim,expectedDigest:digest(row),patch:{power30MinKw:134,powertrainKind:'series_hybrid'},confirmedFields:['power30MinKw','powertrainKind'],source};
const batch={version:1,id:'research-owner-test',entries:[entry]};
test('owner-confirmed motor power keeps manual provenance, original peak power and exact identity',()=>{
 validateBatch(batch);const p=planModelResearch(model,batch.entries,batch);const f=compileModelFacts(p.record)[0];
 assert.equal(f.values.power30MinKw,134);assert.equal(f.values.powerKw,300);assert.equal(f.values.powertrainKind,'series_hybrid');assert.equal(f.sources.power30MinKw.kind,'manual');assert.equal(f.sources.powerKw.kind,'owner_reference');
 assert.equal(planModelResearch(p.record,batch.entries,batch).changes.length,0);
 const changed={...p.record,variants:p.record.variants.map(v=>({...v,power30MinKw:135}))};assert.equal(compileModelFacts(changed)[0].values.power30MinKw,undefined);
});
test('missing owner confirmation, attachment proof or approved reference cannot certify power',()=>{
 for(const edit of [{confirmedByOwner:false},{attachmentSha256:''},{tableRow:0},{powerEvidenceDocument:''},{url:'https://example.com/table'}]){
  const e={...entry,source:{...source,...edit}};assert.throws(()=>validateBatch({...batch,entries:[e]}));
  const p=planModelResearch(model,[e],batch);assert.equal(compileModelFacts(p.record).some(f=>f.values.power30MinKw),false);
 }
});
test('owner source cannot create invented variants or bypass concurrent edits',()=>{
 assert.throws(()=>validateBatch({...batch,entries:[{...entry,operation:'create',expectedDigest:digest(null),expectedRevision:'r1'}]}));
 assert.equal(planModelResearch({...model,variants:[{...row,year:2024}]},batch.entries,batch).changes.length,0);
});
