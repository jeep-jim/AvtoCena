import test from 'node:test';
import assert from 'node:assert/strict';
import {compileModelFacts,modelKey,checksum,applyEncyclopediaCalculation,type CalculationIndex} from '../apps/web/lib/encyclopedia/calculation-index';
import {planReferenceReuse,revalidateReferenceDonorIndex} from '../apps/web/lib/encyclopedia/reference-reuse';
const donor={id:'eu',year:2023,trim:'40 TDI S tronic',status:'observed',markets:['europe'],fuel:'diesel',powertrainKind:'combustion',engineCc:1968,powerHp:204,transmission:'dct',drive:'fwd'};
const target={id:'kr',year:2023,trim:donor.trim,status:'observed',markets:['korea'],fuel:'diesel',transmission:'dct'};
const record=(variants:any[])=>({id:'a6',make:'Audi',model:'A6',revision:'r1',variants});
function index(r:any):CalculationIndex{const models={[modelKey(r.make,r.model)]:compileModelFacts(r)};return {version:1,digest:checksum(models),models,createdAt:'2026-10-23',manifestDigest:'x'};}
test('fills existing exact annual variant once, preserves donors and provenance through recompilation',()=>{
 const r=record([donor,target]),before=JSON.stringify(r),result=planReferenceReuse(r,index(r));
 assert.equal(JSON.stringify(r),before);assert.equal(result.record.variants.length,2);
 assert.equal(result.record.variants[0],donor);assert.equal(result.changes.length,1);
 const saved=result.record.variants[1];assert.equal(saved.powerHp,204);assert.equal(saved.engineCc,1968);assert.equal(saved.status,'observed');assert.deepEqual(saved.markets,['korea']);
 const rebuilt=index(result.record),fact=rebuilt.models['audi:a6'].find(v=>v.variantId==='kr')!;
 assert.equal(fact.sources.powerHp?.kind,'owner_reference');assert.equal(fact.values.powerHp,204);
 assert.equal(fact.values.fuel,'diesel');assert.equal(fact.sources.fuel?.kind,'owner_reference');
 const priced=applyEncyclopediaCalculation({id:'offer',make:'Audi',model:'A6',year:2023,trim:donor.trim},rebuilt);
 assert.equal((priced as any).fuel,'diesel');assert.equal((priced as any).powertrainKind,'combustion');
 assert.equal(planReferenceReuse(result.record,rebuilt).changes.length,0);
 assert.equal(applyEncyclopediaCalculation({...target,id:'offer',make:'Audi',model:'A6'},rebuilt).powerHp,204);
});
test('repairs old filled-only proofs without copying values again or losing unanimous fuel',()=>{
 const r=record([donor,target,{...target,id:'uae',markets:['uae']}]),original=index(r);
 const saved=planReferenceReuse(r,original).record;
 // Reproduce the first publication: existing fuel/transmission were not attested.
 for(const v of saved.variants.slice(1))for(const e of v.referenceEvidence){
  for(const f of ['fuel','transmission']){delete e.values[f];delete e.provenance[f];}
  const {digest,...proof}=e;e.digest=checksum(proof);
 }
 const broken=index(saved);
 assert.equal((applyEncyclopediaCalculation({id:'offer',make:'Audi',model:'A6',year:2023,trim:donor.trim},broken) as any).fuel,undefined);
 const repair=planReferenceReuse(saved,revalidateReferenceDonorIndex(original,broken));
 assert.equal(repair.changes.length,2);assert.ok(repair.changes.every(c=>c.fields.length===0&&c.evidenceFields.includes('fuel')));
 const repaired=index(repair.record),offer=applyEncyclopediaCalculation({id:'offer',make:'Audi',model:'A6',year:2023,trim:donor.trim},repaired) as any;
 assert.equal(offer.fuel,'diesel');assert.equal(offer.powertrainKind,'combustion');assert.equal(offer.powerHp,204);
 assert.equal(planReferenceReuse(repair.record,original).changes.length,0);
 for(const patch of [{powerHp:245},{trim:'45 TFSI'},{year:2024},{status:'review'}]){
  const changed=index({...saved,variants:[{...donor,...patch},...saved.variants.slice(1)]});
  assert.throws(()=>revalidateReferenceDonorIndex(original,changed),/snapshot_changed/);
 }
});
test('different year, technical identity, ambiguous donor and manual edits remain untouched',()=>{
 for(const patch of [{year:2022},{trim:'45 TFSI'},{transmission:'automatic'},{powerHp:245},{generation:'C9'},{engineCode:'other'}]){
  const r=record([donor,{...target,...patch}]);assert.equal(planReferenceReuse(r,index(r)).record,r);
 }
 const ambiguous=record([donor,{...donor,id:'cn',markets:['china'],powerHp:245},target]);
 assert.equal(planReferenceReuse(ambiguous,index(ambiguous)).record.variants[2].powerHp,undefined);
 for(const row of [{...target,status:'verified'},{...target,status:'review'}]){const r=record([donor,row]);assert.equal(planReferenceReuse(r,index(r)).record,r);}
 const manual={...record([donor,target]),editedBy:'human-owner'};assert.equal(planReferenceReuse(manual,index(manual)).record,manual);
});
test('missing certified power is never copied from observed peak or nominal power',()=>{
 const r=record([{...donor,fuel:'electric',powertrainKind:'electric',engineCc:undefined,power30MinKw:80},{...target,fuel:'electric'}]);
 const result=planReferenceReuse(r,index(r));assert.equal(result.record.variants[1].power30MinKw,undefined);
});
test('unknown and zero sentinels receive exact values once, with usable evidence and stable replay',()=>{
 const r=record([donor,{...target,powertrainKind:'unknown',engineCc:0,powerHp:0}]);
 const result=planReferenceReuse(r,index(r));
 const saved=result.record.variants[1];
 assert.equal(saved.powertrainKind,'combustion');
 assert.equal(saved.engineCc,1968);assert.equal(saved.powerHp,204);
 assert.ok(result.changes[0].fields.includes('powertrainKind'));
 const rebuilt=index(result.record),fact=rebuilt.models['audi:a6'].find(v=>v.variantId==='kr')!;
 assert.equal(fact.values.powertrainKind,'combustion');
 assert.equal(fact.sources.powertrainKind?.kind,'owner_reference');
 assert.equal(planReferenceReuse(result.record,rebuilt).changes.length,0);
 assert.equal(planReferenceReuse({...r,editedBy:'human-owner'},index(r)).changes.length,0);
});
test('changing values or identity invalidates retained evidence and public edits cannot install it',async()=>{
 const r=record([donor,target]),saved=planReferenceReuse(r,index(r)).record;
 for(const patch of [{powerHp:999},{year:2024},{trim:'45 TFSI'},{engineCode:'other'}]){
  const altered={...saved,variants:[{...saved.variants[1],...patch}]};assert.equal(compileModelFacts(altered)[0]?.values.powerHp,undefined);
 }
 const {cleanVariant}=await import('../apps/web/lib/encyclopedia/schema');
 assert.equal((cleanVariant(saved.variants[1]) as any).referenceEvidence,undefined);
});
