import test from 'node:test';
import assert from 'node:assert/strict';
import {repairFuelEvidence,repairFuelRows} from '../scripts/lib/catalog-fuel-evidence-repair';
import {classifySpecificationEvidence} from '../apps/web/lib/catalog/specification-evidence-audit';
import {buildBudgetCountIndex,budgetReplayOffer,splitBudgetReplayIndex} from '../apps/web/lib/catalog/budget-count-index';
import {applyUaeManualSpecifications} from '../apps/web/lib/catalog/uae-manual-specifications';
const source=():any=>({id:'b65974b83d5399d588073fc5',market:'uae',make:'Aston Martin',model:'Dbx',year:2023,trim:'Aston Martin DBX707',fuel:'petrol',powertrainKind:'combustion',operational:{semanticEvidence:{fuel:{status:'exact'},powertrainKind:{status:'exact'}}}});
const projection=():any=>{const {operational,...row}=source();return {...row,cardProjectionVersion:3,engineCc:3982,powerHp:707,power30MinKw:undefined,totalRub:null};};
test('repair transfers only bound fuel proof and leaves all other records/values unchanged',()=>{
 const row=projection(),other={...row,id:'111111111111111111111111'},before=JSON.stringify([row,other]),full=source();
 const result=repairFuelRows([row,other],new Map([[row.id,full]]));
 assert.deepEqual(result.changed,[row.id]);assert.equal(result.items[1],other);
 const {fuelPowertrainEvidence,...rest}=result.items[0];assert.deepEqual(rest,row);
 assert.equal(JSON.stringify([row,other]),before);assert.equal(classifySpecificationEvidence(result.items[0],'fuelPowertrain').state,'exact');
 assert.equal(repairFuelEvidence(result.items[0],full),result.items[0]);
 assert.equal(applyUaeManualSpecifications(result.items[0]).engineCc,undefined);
 assert.equal(applyUaeManualSpecifications(result.items[0]).powerHp,undefined);
 assert.equal(result.items[0].power30MinKw,undefined);
});
test('identity/value changes, duplicate targets and unconfirmed source fail closed',()=>{
 for(const patch of [{id:'111111111111111111111111'},{market:'china'},{make:'Audi'},{model:'DB11'},{year:2024},{trim:'V8'},{fuel:'diesel'},{powertrainKind:'electric'}])assert.throws(()=>repairFuelEvidence({...projection(),...patch},source()));
 for(const status of ['missing','ambiguous','conflict'])assert.throws(()=>repairFuelEvidence(projection(),{...source(),operational:{semanticEvidence:{fuel:{status}}}}));
 const row=projection();assert.throws(()=>repairFuelRows([row,row],new Map([[row.id,source()]])),/duplicate/);
 assert.throws(()=>repairFuelEvidence({...row,fuelPowertrainEvidence:{version:0}},source()),/conflict/);
});
test('priced budget replay and split chunks preserve exact trim and fuel proof',()=>{
 const row={...repairFuelEvidence(projection(),source()),totalRub:25031959,sourcePrice:725000,sourceCurrency:'AED'};
 const index=buildBudgetCountIndex('gen_test',[row],new Map([[row.id,7]]),3);
 for(const replay of [budgetReplayOffer(index.rows[0]),budgetReplayOffer([...splitBudgetReplayIndex(index).index.rows[0],splitBudgetReplayIndex(index).chunks[0].value.entries[0][1]] as any)]){
  assert.equal(replay.trim,row.trim);assert.equal(classifySpecificationEvidence(replay,'fuelPowertrain').state,'exact');
  assert.notEqual(classifySpecificationEvidence({...replay,trim:'V8'},'fuelPowertrain').state,'exact');
  assert.equal(applyUaeManualSpecifications(replay).engineCc,undefined);
 }
});
