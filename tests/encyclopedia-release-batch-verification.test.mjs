import test from 'node:test';
import assert from 'node:assert/strict';
import {assertResearchBatchMembership} from '../scripts/encyclopedia/release-batch-verification.mjs';
const token=s=>s.toLowerCase().replace(/\s/g,'');
function fixture(){return {index:{models:{toyota:[{modelId:'m',variantId:'v',year:2026,trims:['520pro'],values:{powerKw:150,power30MinKw:45},sources:{powerKw:{kind:'manufacturer',batchId:'b',url:'https://factory.test/spec'},power30MinKw:{kind:'manufacturer',batchId:'b',url:'https://factory.test/spec'}}}]}},batches:[{id:'b',entries:[{modelId:'m',variantId:'v',year:2026,patch:{powerKw:150,power30MinKw:45,trim:'520 Pro',batteryKwh:58.37},confirmedFields:['powerKw','power30MinKw','trim','batteryKwh'],source:{type:'manufacturer',url:'https://factory.test/spec'}}]}]};}
const check=f=>assertResearchBatchMembership(f.index,f.batches,['powerKw','power30MinKw'],token);
test('mixed batch verifies calculation provenance and trim, separately reports descriptive fields',()=>{assert.deepEqual(check(fixture()),{batches:1,variants:1,fields:2,identityFields:1,descriptiveFieldsOutsideIndex:1});});
test('descriptive fields cannot hide missing or wrong certified power/provenance',()=>{
 for(const change of [f=>delete f.values.power30MinKw,f=>f.values.power30MinKw=150,f=>f.sources.power30MinKw.batchId='other',f=>f.sources.power30MinKw.kind='owner_reference',f=>f.sources.power30MinKw.url='https://other.test']){
  const f=fixture();change(f.index.models.toyota[0]);assert.throws(()=>check(f),/required_field_or_provenance_missing/);
 }
});
test('missing variant, year, renamed trim and unsupported fields fail closed',()=>{
 for(const change of [f=>f.index.models.toyota=[],f=>f.index.models.toyota[0].year=2025,f=>f.index.models.toyota[0].trims=['610max'],f=>f.batches[0].entries[0].confirmedFields.push('unrecognisedPower')]){
  const f=fixture();change(f);assert.throws(()=>check(f),/required_|unsupported_release_field/);
 }
});
test('factory chassis identity must be present and exact in index constraints',()=>{
 const f=fixture(),fact=f.index.models.toyota[0],entry=f.batches[0].entries[0];entry.patch.chassisCode='K9CYH01';entry.confirmedFields.push('chassisCode');fact.constraints={chassisCode:'K9CYH01'};
 assert.equal(check(f).identityFields,2);
 fact.constraints.chassisCode='K9CYH01L';assert.throws(()=>check(f),/required_identity_missing/);
 delete fact.constraints.chassisCode;assert.throws(()=>check(f),/required_identity_missing/);
});
