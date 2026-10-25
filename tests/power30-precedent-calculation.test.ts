import test,{mock} from 'node:test';
import assert from 'node:assert/strict';
import {power30Precedent,offerPrecedentParameterDraft} from '../apps/web/lib/catalog/power30-precedent';
import {LocalJsonStorage} from '../apps/web/lib/data';
import {resetCatalogRateCache} from '../apps/web/lib/catalog/rates';
import {calculateOfferWithCustomerParametersDetailed,calculateCustomerParameterScenario} from '../apps/web/lib/catalog/customs-pricing';
import {validateCustomerParameters} from '../apps/web/lib/catalog/customer-parameters';
import {attachSellerDeliveredPreviews} from '../apps/web/lib/catalog/seller-delivered-preview';
import {savedPreviewEntry} from '../apps/web/lib/catalog/saved-calculation-previews';
import {offerWithSavedPreview} from '../apps/web/lib/catalog/saved-calculation-preview';
import {savedOfferIdentity} from '../apps/web/lib/catalog/saved-offer-calculation';
const offer:any={id:'precedent-p7-test',market:'china',sourceId:'fixture',sourceOfferId:'p7',make:'XPeng',model:'P7',year:2024,fuel:'electric',powertrainKind:'electric',powerHp:276,drive:'rwd',sourcePrice:120000,sourceCurrency:'CNY',catalogPricingMode:'seller'};
test('reusable model reference survives listing and price changes, preserves manual values and ambiguity',()=>{
 assert.equal(power30Precedent(offer,null)?.kw,80);
 assert.equal(power30Precedent({...offer,id:'new-feed-id',sourcePrice:150000},null)?.kw,80);
 assert.equal(power30Precedent({...offer,power30MinKw:95},null),undefined);
 assert.equal(power30Precedent({...offer,manualEditedAt:'today'},null),undefined);
 assert.equal(power30Precedent({...offer,drive:'awd',powerHp:473},null),undefined);
 assert.equal(power30Precedent({...offer,make:'Xiaomi',model:'YU7'},null),undefined,'different reported versions cannot become one price');
 assert.equal(power30Precedent({...offer,market:'uae'},null),undefined);
 assert.equal(power30Precedent({...offer,model:'P7+'},null),undefined);
});
test('model precedent reaches real price engine, visible preview and saved scenario without certifying source',async()=>{
 const original=structuredClone(offer),today=new Date().toISOString().slice(0,10);
 const readOriginal=LocalJsonStorage.prototype.readJsonWithMeta;
 const storage=mock.method(LocalJsonStorage.prototype,'readJsonWithMeta',async function(this:LocalJsonStorage,key:string,fallback:any){
  if(key==='fees/exchange-rates.json')return {found:true,value:{updatedAt:today,...Object.fromEntries(Object.entries({CNY:12,USD:90,EUR:100}).map(([currency,cbrRate])=>[currency,{currency,cbrRate,nominal:1,rateDate:today,rateSource:'cbr'}]))}};
  return readOriginal.call(this,key,fallback);
 });resetCatalogRateCache();
 try{
  const draft=offerPrecedentParameterDraft(offer),parameters=validateCustomerParameters(draft);
  assert.equal(draft.power30MinKw,'80');assert.equal(draft._power30EstimateKw,'80');
  const result=await calculateOfferWithCustomerParametersDetailed(offer,parameters);assert.ok(result.ok);
  assert.ok(result.calculation.totalRub!>0);assert.equal(result.calculation.power30Precedent?.certified,false);
  assert.ok(result.calculation.warnings.some(w=>w.includes('близкой версии')));
  const scenario=await calculateCustomerParameterScenario(offer,parameters);assert.equal(scenario.powerDataSource,'model_precedent');
  const [card]:any[]=await attachSellerDeliveredPreviews([offer],{}, {projectionOnly:true});
  assert.equal(card.deliveredCalculationPreview.totalRub,result.calculation.totalRub);
  assert.equal(card.deliveredCalculationPreview.power30Precedent.kw,80);
  const entry=savedPreviewEntry({offerId:offer.id,identity:savedOfferIdentity(offer),version:'test',savedAt:today,savedBy:'test',draft,calculation:result.calculation},offer)!;
  const saved=offerWithSavedPreview({...offer,savedCalculationPreview:entry.preview});
  assert.equal(saved.powerDataConfidence,'estimated');assert.equal(saved.savedCalculationPreview.power30Precedent.kw,80);
  assert.deepEqual(offer,original);assert.equal(offer.power30MinKw,undefined);
 }finally{storage.mock.restore();resetCatalogRateCache();}
});
