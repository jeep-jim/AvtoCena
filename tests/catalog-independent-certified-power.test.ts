import test from 'node:test';
import assert from 'node:assert/strict';
import {safePublicPricing} from '../apps/web/lib/catalog/safe-public-pricing';
import {hasEncyclopediaCalculationEvidence} from '../apps/web/lib/encyclopedia/calculation-evidence';
import {classifySpecificationEvidence} from '../apps/web/lib/catalog/specification-evidence-audit';

// Reduced from the read-only Li L6 diagnostic: peak power was quarantined
// before the immutable index supplied a separately owner-confirmed 134 kW.
function fixture():any {
 const id='17b4b13194dc355e6415013f',year=2026;
 return {id,year,market:'china',make:'Li Auto',model:'L6',trim:'2026款 Ultra',
  fuel:'hybrid',powertrainKind:'series_hybrid',engineCc:1496,power30MinKw:134,
  totalRub:123456,calculationStatus:'estimated',publicVisibleRub:123456,
  operational:{semanticEvidence:{powerHp:{status:'conflict'},powerKw:{status:'conflict'},
   engineCc:{status:'exact'},fuel:{status:'exact'},powertrainKind:{status:'exact'}}},
  encyclopediaCalculation:{version:1,indexDigest:'a800304f',sourceIdentity:JSON.stringify([id,year]),
   values:{fuel:'hybrid',powertrainKind:'series_hybrid',engineCc:1496,power30MinKw:134},filledFields:['power30MinKw']}};
}
test('independent bound 30-minute power survives peak quarantine without reviving a price',()=>{
 const input=fixture(),before=structuredClone(input),result=safePublicPricing(input);
 assert.equal(result.power30MinKw,134);
 assert.equal(hasEncyclopediaCalculationEvidence(result),true);
 assert.equal(classifySpecificationEvidence(result,'certifiedPower').state,'exact');
 assert.equal(classifySpecificationEvidence(result,'powerHp').state,'conflict');
 assert.equal(result.powerHp,undefined);assert.equal(result.powerKw,undefined);
 assert.equal(result.utilizationPowerKw,undefined);assert.equal(result.totalRub,null);
 assert.equal(result.publicVisibleRub,undefined);assert.equal(result.calculationStatus,'needs_data');
 assert.deepEqual(safePublicPricing(result),result);assert.deepEqual(input,before);
});
test('changed id, year or certified value invalidates the independent attestation',()=>{
 for(const patch of [{id:'another-offer'},{year:2025},{power30MinKw:135}]) {
  const result=safePublicPricing(Object.assign(fixture(),patch));
  assert.equal(result.power30MinKw,undefined);assert.equal(result.totalRub,null);
 }
});
test('unattested and unknown certified power remain unavailable',()=>{
 for(const value of [134,undefined]) {
  const input=fixture();delete input.encyclopediaCalculation;input.power30MinKw=value;
  assert.equal(safePublicPricing(input).power30MinKw,undefined);
 }
});
test('conflicting or ambiguous certified evidence cannot survive peak quarantine',()=>{
 for(const status of ['conflict','ambiguous']) {
  const input=fixture();input.operational.semanticEvidence.power30MinKw={status};
  assert.equal(safePublicPricing(input).power30MinKw,undefined);
 }
});
test('attestation containing rejected peak power is not promoted to independent proof',()=>{
 const input=fixture();input.powerHp=154;input.encyclopediaCalculation.values.powerHp=154;
 assert.equal(safePublicPricing(input).power30MinKw,undefined);
});
test('an attestation for unrelated fields cannot certify 30-minute power',()=>{
 const input=fixture();delete input.encyclopediaCalculation.values.power30MinKw;
 input.operational.semanticEvidence.power30MinKw={status:'exact',value:134};
 assert.equal(safePublicPricing(input).power30MinKw,undefined);
});
test('fuel or engine conflicts remain quarantined even with certified power evidence',()=>{
 for(const field of ['engineCc','fuel']) {
  const input=fixture();input.operational.semanticEvidence[field]={status:'conflict'};
  const result=safePublicPricing(input);assert.equal(result.power30MinKw,undefined);
  assert.equal(result.totalRub,null);
 }
});
