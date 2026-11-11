import test from 'node:test';
import assert from 'node:assert/strict';
import {publicOffer,searchProjectionFromOffer} from '../apps/web/lib/catalog/storage';
import {classifySpecificationEvidence,compactFuelPowertrainEvidence} from '../apps/web/lib/catalog/specification-evidence-audit';
import {hasFuelPowertrainEvidence} from '../apps/web/lib/catalog/fuel-powertrain-evidence';
import {applyUaeManualSpecifications} from '../apps/web/lib/catalog/uae-manual-specifications';

const offer=():any=>({id:'dbx-offer',market:'uae',make:'Aston Martin',model:'DBX',year:2023,trim:'707',fuel:'petrol',powertrainKind:'combustion',images:[],sourcePrice:725000,sourceCurrency:'AED',totalRub:null,operational:{semanticEvidence:{fuel:{status:'exact',raw:'private source content'},powertrainKind:{status:'exact'}}}});
const json=(value:any)=>JSON.parse(JSON.stringify(value));

test('source fuel confirmation survives search and public serialization without private metadata',()=>{
 const input=offer(),before=JSON.stringify(input);
 for(const row of [json(searchProjectionFromOffer(input)),json(publicOffer(input))]){
  assert.equal(row.operational,undefined);
  assert.equal(JSON.stringify(row).includes('private source content'),false);
  assert.equal(classifySpecificationEvidence(row,'fuelPowertrain').state,'exact');
  assert.equal(hasFuelPowertrainEvidence(row),true);
 }
 assert.equal(JSON.stringify(input),before);
});

test('fuel confirmation is bound to vehicle identity and unchanged fuel and engine kind',()=>{
 const row=json(searchProjectionFromOffer(offer()));
 for(const patch of [{id:'other'},{market:'korea'},{make:'Audi'},{model:'DB11'},{year:2024},{trim:'V8'},{fuel:'diesel'},{powertrainKind:'electric'}]){
  assert.equal(hasFuelPowertrainEvidence({...row,...patch}),false,JSON.stringify(patch));
  assert.notEqual(classifySpecificationEvidence({...row,...patch},'fuelPowertrain').state,'exact');
 }
});

test('unconfirmed, conflicting and review data cannot gain or retain a compact confirmation',()=>{
 const original=offer(),proof=compactFuelPowertrainEvidence(original);
 const cases=[{operational:{}},...['conflict','ambiguous','missing'].map(status=>({fuelPowertrainEvidence:proof,operational:{semanticEvidence:{fuel:{status}}}})),{fuelPowertrainEvidence:proof,operational:{knowledgeCore:{fieldsApplied:['fuel'],variantStatus:'review',variantId:'v'}}}];
 for(const patch of cases){
  const input={...original,...patch};
  assert.equal(compactFuelPowertrainEvidence(input),undefined);
  for(const row of [json(searchProjectionFromOffer(input)),json(publicOffer(input))]){
   assert.equal(row.fuelPowertrainEvidence,undefined);
   assert.notEqual(classifySpecificationEvidence(row,'fuelPowertrain').state,'exact');
  }
 }
});

test('fuel confirmation never authorizes seller displacement, horsepower or electric certification',()=>{
 const input={...offer(),engineCc:3982,powerHp:707},row=json(searchProjectionFromOffer(input));
 assert.equal(classifySpecificationEvidence(row,'fuelPowertrain').state,'exact');
 assert.equal(applyUaeManualSpecifications(row).engineCc,undefined);
 assert.equal(applyUaeManualSpecifications(row).powerHp,undefined);
 const electric={...offer(),fuel:'electric',powertrainKind:'electric'};
 const ev=json(searchProjectionFromOffer(electric));
 assert.equal(classifySpecificationEvidence(ev,'fuelPowertrain').state,'exact');
 assert.equal(classifySpecificationEvidence(ev,'certifiedPower').state,'missing');
});
