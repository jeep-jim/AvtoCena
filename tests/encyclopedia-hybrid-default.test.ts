import test from 'node:test';
import assert from 'node:assert/strict';
import {applyEncyclopediaCalculation,checksum,modelKey} from '../apps/web/lib/encyclopedia/calculation-index';
const fields={fuel:'hybrid',powertrainKind:'series_hybrid',engineCc:1496,powerHp:408,powerKw:300.08,drive:'awd',transmission:'automatic',icePowerKw:110,power30MinKw:134};
const row:any={modelId:'model',variantId:'max',revision:'reviewed',year:2025,trims:['maxsmartrefreshedition'],constraints:fields,values:fields,sources:Object.fromEntries(Object.keys(fields).map(f=>[f,{kind:f==='powertrainKind'||f==='power30MinKw'?'manual':'manufacturer',batchId:'research-reviewed',url:'https://manufacturer.example/spec'}]))};
const raw:any={id:'source-l6',market:'china',sourceId:'autohome_used_china_open',make:'Li Auto',model:'Li L6',year:2025,trim:'Max Smart Refresh Edition',fuel:'hybrid',powertrainKind:'other_hybrid',engineCc:1496,powerHp:408,powerKw:300.08,drive:'awd',transmission:'automatic',operational:{semanticEvidence:{fuel:{status:'exact',value:'hybrid',source:'auto_api_che168:engine_type'}}}};
function apply(o:any=raw,rows:any[]=[row]){const models={[modelKey(raw.make,raw.model)]:rows};return applyEncyclopediaCalculation(o,{version:1,digest:checksum(models),manifestDigest:'m',createdAt:'now',models});}
test('source hybrid default reaches reviewed series subtype and missing component powers',()=>{
 const before=structuredClone(raw),r=apply();assert.equal(r.powertrainKind,'series_hybrid');assert.equal(r.icePowerKw,110);assert.equal(r.power30MinKw,134);
 assert.equal(r.operational.encyclopediaPowertrainRefinement.originalKind,'other_hybrid');assert.deepEqual(raw,before);
 assert.equal(apply(r).powertrainKind,'series_hybrid');
});
test('explicit subtype, manual fields, wrong source, year and mechanical conflicts are preserved',()=>{
 for(const patch of [{manualEditedAt:'now'},{powerDataSource:'customer_input'},{year:2024},{engineCc:1998},{drive:'fwd'},{powerHp:154,powerKw:113.3},{sourceId:'another_source'},{market:'uae'},{trim:undefined},{trim:'another version'},{fuel:'petrol'},{operational:{semanticEvidence:{...raw.operational.semanticEvidence,powertrainKind:{status:'exact',value:'other_hybrid',source:'supplier_named_powertrain'}}}},{operational:{semanticEvidence:{fuel:{status:'conflict',source:'auto_api_che168:engine_type',value:'hybrid'}}}}]){
  const o={...raw,...patch},r=apply(o);assert.equal(r.powertrainKind,'other_hybrid',JSON.stringify(patch));assert.equal(r.power30MinKw,undefined);
 }
});
test('unreviewed, incomplete or conflicting exact candidates cannot refine the default',()=>{
 for(const rows of [[{...row,sources:{...row.sources,powertrainKind:{kind:'owner_reference'}}}],[{...row,values:{...row.values,drive:undefined}}],[row,{...row,variantId:'parallel',values:{...row.values,powertrainKind:'other_hybrid',power30MinKw:undefined},constraints:{...row.constraints,powertrainKind:'other_hybrid'}}]]){
  assert.equal(apply(raw,rows).powertrainKind,'other_hybrid');assert.equal(apply(raw,rows).power30MinKw,undefined);
 }
});
test('a replaced index retires the refined subtype and restores its source default',()=>{
 const r=apply();const retired=apply(r,[]);
 assert.equal(retired.powertrainKind,'other_hybrid');assert.equal(retired.icePowerKw,undefined);assert.equal(retired.power30MinKw,undefined);
 assert.equal(retired.operational.semanticEvidence.fuel.source,'auto_api_che168:engine_type');
 assert.equal(retired.operational.encyclopediaPowertrainRefinement,undefined);
});
test('refined Li L6 reaches actual customer calculation with separate ICE and 30-minute fields',async()=>{
 const {mock}=await import('node:test');const {LocalJsonStorage}=await import('../apps/web/lib/data');
 const {resetCatalogRateCache}=await import('../apps/web/lib/catalog/rates');
 const {offerParameterDraft}=await import('../apps/web/lib/catalog/offer-parameter-draft');
 const {validateCustomerParameters}=await import('../apps/web/lib/catalog/customer-parameters');
 const {calculateOfferWithCustomerParametersDetailed}=await import('../apps/web/lib/catalog/customs-pricing');
 const original=LocalJsonStorage.prototype.readJsonWithMeta,today=new Date().toISOString().slice(0,10);
 const stub=mock.method(LocalJsonStorage.prototype,'readJsonWithMeta',async function(this:InstanceType<typeof LocalJsonStorage>,key:string,fallback:any){
  if(key==='fees/exchange-rates.json')return {found:true,value:{updatedAt:today,...Object.fromEntries(Object.entries({CNY:12,USD:90,EUR:100}).map(([currency,cbrRate])=>[currency,{currency,cbrRate,nominal:1,rateDate:today,rateSource:'cbr'}]))}};
  return original.call(this,key,fallback);
 });resetCatalogRateCache();
 try{
  const offer=apply({...raw,sourcePrice:219800,sourceCurrency:'CNY',catalogPricingMode:'seller'});
  const draft=offerParameterDraft(offer);assert.equal(draft.hybridKind,'series_hybrid');assert.equal(draft.icePowerKw,'110');assert.equal(draft.power30MinKw,'134');
  const result=await calculateOfferWithCustomerParametersDetailed(offer,validateCustomerParameters(draft));
  assert.ok(result.ok,JSON.stringify(result));assert.ok(result.calculation.totalRub!>0);
 }finally{stub.mock.restore();resetCatalogRateCache();}
});
