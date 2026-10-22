import test from 'node:test';
import assert from 'node:assert/strict';
import {compileModelFacts,applyEncyclopediaCalculation,checksum,modelKey,hasEncyclopediaCalculationEvidence,type CalculationIndex} from '../apps/web/lib/encyclopedia/calculation-index';
import {classifySpecificationEvidence} from '../apps/web/lib/catalog/specification-evidence-audit';
import {specificationEvidenceComplete} from '../apps/web/lib/catalog/modification-matching';
import {applyUaeManualSpecifications} from '../apps/web/lib/catalog/uae-manual-specifications';
const record=(variants:any[])=>({id:'model',make:'Audi',model:'A6',revision:'r1',variants});
const base={id:'v1',year:2023,trim:'40 TDI S tronic',status:'observed',markets:['europe'],fuel:'diesel',powertrainKind:'combustion',engineCc:1968,powerHp:204,powerKw:150,transmission:'dct',drive:'fwd'};
const offer=()=>({make:'Audi',model:'A6',year:2023,trim:base.trim,market:'korea',sourceId:'ajes_korea_feed',sourceOfferId:'1',id:'1',fuel:'diesel',transmission:'dct',drive:'fwd',operational:{}});
function index(variants:any[]):CalculationIndex{const models={[modelKey('Audi','A6')]:compileModelFacts(record(variants))};return {version:1,digest:checksum(models),createdAt:'2026-10-22',manifestDigest:'x',models};}
test('owner-approved Europe facts fill exact Korean variant without promoting observations to factory verification',()=>{
 const i=index([base]),out:any=applyEncyclopediaCalculation(offer(),i);
 assert.equal(out.engineCc,1968);assert.equal(out.powerHp,204);assert.equal(out.powerDataConfidence,'source_exact');
 assert.equal(out.operational.encyclopediaCalculation.provenance.powerHp[0].kind,'owner_reference');
 assert.equal(base.status,'observed');assert.equal(specificationEvidenceComplete(out),true);
 assert.equal(hasEncyclopediaCalculationEvidence(out),true);
});
test('different year, model, fuel, transmission, generation or trim cannot borrow power',()=>{
 for(const patch of [{year:2022},{model:'A6L'},{fuel:'petrol'},{transmission:'manual'},{generation:'C9'},{trim:'45 TFSI'}]){
  const input={...offer(),...patch};assert.equal(applyEncyclopediaCalculation(input,index([base])),input);
 }
});
test('ambiguous exact trim does not select a winning engine and generic trim is never technical identity',()=>{
 const out:any=applyEncyclopediaCalculation(offer(),index([base,{...base,id:'v2',engineCc:2967,powerHp:245,powerKw:180}]));
 assert.equal(out.powerHp,undefined);assert.equal(out.engineCc,undefined);
 const input={...offer(),trim:'Premium'};assert.equal(applyEncyclopediaCalculation(input,index([{...base,trim:'Premium'}])),input);
});
test('factory evidence is field-specific, stale values and unconfirmed fields stay unavailable',()=>{
 const row={...base,status:'review',researchEvidence:{batchId:'research-1',checkedIdentity:{make:'Audi',model:'A6',year:2023,trim:base.trim},fields:['engineCc','powerHp'],values:{engineCc:1968,powerHp:204},source:{type:'manufacturer',url:'https://www.audi.com/spec.pdf'}}};
 const facts=compileModelFacts(record([row]));assert.deepEqual(Object.keys(facts[0].values).sort(),['engineCc','powerHp']);
 const stale=compileModelFacts(record([{...row,powerHp:245}]));assert.equal(stale[0].values.powerHp,undefined);
 const out:any=applyEncyclopediaCalculation(offer(),index([row]));assert.equal(out.powerHp,204);assert.equal(out.powertrainKind,undefined);
 assert.equal(classifySpecificationEvidence(out,'powerHp').state,'exact');
});
test('manual input and explicit conflicts survive; a source value is never replaced',()=>{
 const manual={...offer(),powerDataSource:'customer_input',powerHp:210};assert.equal(applyEncyclopediaCalculation(manual,index([base])),manual);
 const existing={...offer(),powerHp:210};assert.equal(applyEncyclopediaCalculation(existing,index([base])),existing);
 const conflict={...offer(),operational:{semanticEvidence:{powerHp:{status:'conflict'}}}};
 assert.equal((applyEncyclopediaCalculation(conflict,index([base])) as any).powerHp,undefined);
});
test('peak and nominal electric power cannot fill certified 30-minute power',()=>{
 const row={...base,fuel:'electric',powertrainKind:'electric',engineCc:undefined,powerHp:340,powerKw:250,power30MinKw:80};
 const input={...offer(),fuel:'electric'};const out:any=applyEncyclopediaCalculation(input,index([row]));
 assert.equal(out.power30MinKw,undefined);assert.equal(classifySpecificationEvidence(out,'certifiedPower').state,'missing');assert.equal(specificationEvidenceComplete(out),false);
});
test('UAE seller data is discarded first; only independently matched encyclopedia fields survive sanitation',()=>{
 const raw={...offer(),market:'uae',powerHp:999,engineCc:9999};
 const safe=applyUaeManualSpecifications(raw);assert.equal(safe.powerHp,undefined);
 const matched:any=applyEncyclopediaCalculation(safe,index([base]));assert.equal(matched.powerHp,204);
 assert.equal(applyUaeManualSpecifications(matched),matched);
 const changed={...matched,powerHp:999};assert.equal(hasEncyclopediaCalculationEvidence(changed),false);assert.equal(applyUaeManualSpecifications(changed).powerHp,undefined);
});
test('no index means no inference; original records are immutable and repeated enrichment is stable',()=>{
 const input=offer(),before=JSON.stringify(input);assert.equal(applyEncyclopediaCalculation(input,null),input);
 const i=index([base]),result=applyEncyclopediaCalculation(input,i);assert.equal(JSON.stringify(input),before);assert.equal(applyEncyclopediaCalculation(result,i),result);
});
