import test,{mock} from 'node:test';
import assert from 'node:assert/strict';
import {LocalJsonStorage} from '../apps/web/lib/data';
import {managementParameters,managementDraft,rememberManagementCalculation,readManagementKnowledge,MANAGEMENT_KNOWLEDGE_PATH} from '../apps/web/lib/catalog/management-knowledge';
import {modelKey} from '../apps/web/lib/encyclopedia/calculation-index';
import {offerPrecedentParameterDraft} from '../apps/web/lib/catalog/power30-precedent';
import {calculateOfferWithCustomerParametersDetailed} from '../apps/web/lib/catalog/customs-pricing';
import {validateCustomerParameters} from '../apps/web/lib/catalog/customer-parameters';
import {resetCatalogRateCache} from '../apps/web/lib/catalog/rates';
const donor:any={id:'donor',make:'Honda',model:'Vezel',year:2025,fuel:'petrol',engineCc:1600,powerHp:150,drive:'fwd',powertrainKind:'combustion'};
const fact:any={offerId:donor.id,version:'one',savedAt:'2026-10-26',savedBy:'staff',key:modelKey(donor.make,donor.model),year:2025,values:donor};
const index:any={version:1,revision:'one',models:{[fact.key]:{donor:fact}}};
test('one management save fills both owner examples across every market and future IDs',()=>{
 for(const market of ['china','japan','korea','uae','europe','georgia']){
  const one=managementParameters({...donor,id:'future-'+market,market,powerHp:undefined},index);
  assert.equal(one.powerHp,150);
  const two=managementParameters({...donor,id:'other-'+market,market,engineCc:undefined},index);
  assert.equal(two.engineCc,1600);
 }
 assert.equal(donor.powerHp,150);
});
test('known values, year, mechanical conflicts, weak matches and model identities are preserved',()=>{
 for(const override of [{powerHp:160},{drive:'awd'},{fuel:'hybrid'},{year:2024},{model:'Vezel+'},{engineCc:2000},{powerKw:130}])assert.deepEqual(managementParameters({...donor,id:'new',powerHp:undefined,...override},index),{});
 assert.deepEqual(managementParameters({id:'new',make:'Honda',model:'Vezel',year:2025,fuel:'petrol'},index),{});
 const conflict=structuredClone(index);conflict.models[fact.key].second={...fact,offerId:'second',values:{...donor,powerHp:180}};
 assert.equal(managementParameters({...donor,id:'new',powerHp:undefined},conflict).powerHp,undefined);
 const draft=managementDraft({operational:{managementKnowledge:{parameters:{powerHp:150}}}},{powerHp:'170'});
 assert.equal(draft.powerHp,'170');
});
test('confirmed knowledge is durable, revisioned and reaches the actual price engine with a new seller price',async()=>{
 const map=new Map<string,any>();const today=new Date().toISOString().slice(0,10);
 const original=LocalJsonStorage.prototype.readJsonWithMeta;
 const read=mock.method(LocalJsonStorage.prototype,'readJsonWithMeta',async function(this:LocalJsonStorage,key:string,fallback:any){
  if(key.startsWith('knowledge/management-vehicle-parameters/'))return {found:map.has(key),etag:map.has(key)?'etag':undefined,value:structuredClone(map.get(key)??fallback)};
  if(key==='fees/exchange-rates.json')return {found:true,value:{updatedAt:today,...Object.fromEntries(Object.entries({CNY:12,USD:90,EUR:100,KRW:0.06,AED:25}).map(([currency,cbrRate])=>[currency,{currency,cbrRate,nominal:1,rateDate:today,rateSource:'cbr'}]))}};
  return original.call(this,key,fallback);
 });
 const write=mock.method(LocalJsonStorage.prototype,'writeJson',async(key:string,value:any)=>{assert.ok(key.startsWith('knowledge/management-vehicle-parameters/'));map.set(key,structuredClone(value));});
 resetCatalogRateCache();
 try{
  const record={version:'save1',savedAt:'2026-10-26T10:00:00Z',savedBy:'staff',draft:{year:'2025',fuel:'petrol',engineCc:'1600',powerHp:'150',vehicleCategory:'M1',deliveryCity:'Новокузнецк'}};
  await rememberManagementCalculation(donor,record);
  const stored=await readManagementKnowledge();assert.equal(stored.revision,'save1');assert.ok(map.has(MANAGEMENT_KNOWLEDGE_PATH));assert.equal(map.size,2);
  assert.equal(stored.models[fact.key].donor.values.deliveryCity,undefined);
  const target:any={...donor,id:'fresh',market:'china',sourceId:'fixture',sourceOfferId:'fresh',sourcePrice:80000,sourceCurrency:'CNY',powerHp:undefined,catalogPricingMode:'seller'};
  const parameters=managementParameters(target,stored);const enriched={...target,operational:{managementKnowledge:{revision:stored.revision,parameters}}};
  const draft=offerPrecedentParameterDraft(enriched);assert.equal(draft.powerHp,'150');
  const result=await calculateOfferWithCustomerParametersDetailed(enriched,validateCustomerParameters(draft));assert.equal(result.ok,true);
  const later=await calculateOfferWithCustomerParametersDetailed({...enriched,sourcePrice:100000},validateCustomerParameters(draft));assert.ok(result.ok&&later.ok&&later.calculation.totalRub>result.calculation.totalRub);
  assert.equal(target.powerHp,undefined);
  await rememberManagementCalculation(donor,{...record,version:'save2',savedAt:'2026-10-26T11:00:00Z',draft:{...record.draft,powerHp:'160'}});
  assert.equal((await readManagementKnowledge()).models[fact.key].donor.values.powerHp,160);assert.equal(map.size,3);
 }finally{read.mock.restore();write.mock.restore();resetCatalogRateCache();}
});
