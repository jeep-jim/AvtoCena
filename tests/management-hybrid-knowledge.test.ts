import test,{mock} from 'node:test';
import {LocalJsonStorage} from '../apps/web/lib/data';
import assert from 'node:assert/strict';
import {managementParameters,managementDraft,encyclopediaWithManagement,readManagementKnowledge} from '../apps/web/lib/catalog/management-knowledge';
import {encyclopediaReviewDisplay,variantReviewClass} from '../apps/web/components/encyclopedia/review-state';
import {validateCustomerParameters} from '../apps/web/lib/catalog/customer-parameters';
import {fieldChoices} from '../apps/web/lib/encyclopedia/presentation';
const row:any={id:'v',year:2026,fuel:'hybrid',powertrainKind:'hev',engineCc:1497,powerHp:98,drive:'rwd',transmission:'automatic',bodyType:'sedan',markets:[],status:'observed',observedCount:1};
const record:any={id:'model',make:'Changan',model:'A06',revision:'one',variants:[row]};
function knowledge(values:any,offerId='card'){return {version:1,revision:'save',models:{'changan:a06':{[offerId]:{offerId,year:2026,values,version:'save',savedAt:'2026-11-01',savedBy:'owner',key:'changan:a06'}}}} as any;}
test('card hybrid facts fill the same legacy HEV variant and make it blue',()=>{
 const index=knowledge({...row,powertrainKind:'other_hybrid',icePowerKw:72,power30MinKw:45});
 const applied=encyclopediaWithManagement(record,index);
 assert.equal(applied.variants[0].power30MinKw,45);
 assert.equal(applied.variants.length,1,'equivalent labels must not create an extra staff row');
 assert.equal(variantReviewClass(encyclopediaReviewDisplay(record,applied).variants[0]),'ac-ency-row-review');
 assert.equal(record.variants[0].power30MinKw,undefined);
});
test('legacy encyclopedia hybrid labels produce a usable card draft in reverse',()=>{
 const input:any={id:'recipient',make:'Changan',model:'A06',year:2026,fuel:'hybrid',engineCc:1497,powerHp:98,drive:'rwd'};
 const parameters=managementParameters(input,knowledge({...row,icePowerKw:72,power30MinKw:45},'encyclopedia:model:v'));
 assert.equal(parameters.powertrainKind,'other_hybrid');
 const draft=managementDraft({...input,operational:{managementKnowledge:{parameters}}},{year:'2026',fuel:'hybrid',engineCc:'1497',powerHp:'98'});
 assert.equal(validateCustomerParameters(draft).power30MinKw,45);
 assert.equal(validateCustomerParameters(draft).powertrainKind,'other_hybrid');
});
test('aliases do not merge series and other hybrids or overwrite filled certified power',()=>{
 const index=knowledge({...row,icePowerKw:72,power30MinKw:45},'encyclopedia:model:v');
 const input={...row,id:'recipient',make:'Changan',model:'A06'};
 for(const patch of [{powertrainKind:'series_hybrid'},{drive:'awd'},{year:2025},{powerHp:163},{fuel:'electric'},{power30MinKw:60}])assert.deepEqual(managementParameters({...input,...patch},index),{});
 assert.equal(managementParameters({...input,power30MinKw:45},index).power30MinKw,undefined);
});
test('new encyclopedia choices use the same calculation types as card inputs',()=>{
 assert.deepEqual(fieldChoices.powertrainKind,['combustion','series_hybrid','other_hybrid','electric']);
 assert.deepEqual(fieldChoices.fuel,['petrol','diesel','electric','hybrid','lpg','cng']);
});

test('editor refresh reads a save from another worker without waiting for the catalog cache TTL',async()=>{
 let index=knowledge({...row,power30MinKw:30});
 const read=mock.method(LocalJsonStorage.prototype,'readJsonWithMeta',async()=>({found:true,value:structuredClone(index)}));
 try{
  assert.equal((await readManagementKnowledge()).models['changan:a06'].card.values.power30MinKw,30);
  index=knowledge({...row,power30MinKw:45});index.revision='new-save';
  assert.equal((await readManagementKnowledge()).models['changan:a06'].card.values.power30MinKw,30);
  assert.equal((await readManagementKnowledge(true)).models['changan:a06'].card.values.power30MinKw,45);
 }finally{read.mock.restore();}
});

test('legacy hybrid fuel/subtype choices remain usable without rewriting stored rows',()=>{
 for(const alias of ['hev','phev','mhev']){
  const legacy={...row,fuel:alias,powertrainKind:alias,icePowerKw:72,power30MinKw:45};
  const target:any={id:'recipient',make:'Changan',model:'A06',year:2026,engineCc:1497,drive:'rwd',powerHp:98};
  const parameters=managementParameters(target,knowledge(legacy,'encyclopedia:model:v'));
  assert.equal(parameters.fuel,'hybrid');assert.equal(parameters.powertrainKind,'other_hybrid');
  assert.equal(validateCustomerParameters(managementDraft({...target,operational:{managementKnowledge:{parameters}}},{year:'2026',engineCc:'1497',powerHp:'98'})).power30MinKw,45);
  assert.equal(legacy.fuel,alias);
 }
});
