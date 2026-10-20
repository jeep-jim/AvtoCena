import {catalogOfferVisibleRub} from '../apps/web/lib/catalog/public-priority';
import test,{mock} from 'node:test';
import assert from 'node:assert/strict';
import {dubicarsDisplacement,restoreDubicarsDisplacement} from '../apps/web/lib/catalog/dubicars-displacement';
import {safePublicPricing} from '../apps/web/lib/catalog/safe-public-pricing';
import {normalizeVehicleOfferSpecs} from '../apps/web/lib/catalog/spec-normalization';
import {inventorySourceEvidence} from '../apps/web/lib/catalog/prepare-seller-inventory';
const jac=()=>({id:'cb659e39eaf16e5dae6a8c36',market:'uae',sourceId:'dubicars_uae_exact',sourceOfferId:'952829',make:'JAC',model:'JS4',fuel:'petrol',powertrainKind:'combustion',sourcePrice:57000,sourceCurrency:'AED',engineCc:undefined,updatedAt:'2026-10-18T14:33:41.193Z',operational:{provider:'auto-api.com',sourceDisplacementLabel:'1.5',exactDetail:true,semanticEvidence:{engineCc:{status:'missing',source:'auto_api_dubicars:displacement_cc'}}}});
test('supplier litre and legacy cc formats convert once with provenance',()=>{
 for(const [raw,cc] of [['1.5',1500],['2.0',2000],['3.5',3500],[6.2,6200],['1.498',1498],[6200,6200],['1998',1998]] as const)assert.equal(dubicarsDisplacement(raw)?.cc,cc);
 for(const raw of ['',null,0,-1,'1.5/2.0','1500 cc','NaN',1.23456,99999])assert.equal(dubicarsDisplacement(raw),undefined);
});
test('saved UAE source metrics are removed from display, normalization and publication',()=>{
 const input=jac();
 for(const restore of [restoreDubicarsDisplacement,safePublicPricing,normalizeVehicleOfferSpecs,inventorySourceEvidence]){
  const out:any=restore(input as any);assert.equal(out.engineCc,undefined);assert.equal(out.sourcePrice,57000);assert.equal(out.updatedAt,input.updatedAt);assert.equal(out.operational.sourceDisplacementLabel,undefined);assert.equal(out.powerHp,undefined);
 }
 assert.equal(input.engineCc,undefined);const restored=restoreDubicarsDisplacement(input);assert.deepEqual(restoreDubicarsDisplacement(restored),restored);
});
test('all UAE sources and electric power are manual-only; other markets stay unchanged',()=>{
 for(const market of ['china','korea','japan','europe','georgia']){
  const input={...jac(),market,engineCc:1499,powerHp:147};assert.equal(restoreDubicarsDisplacement(input),input);
 }
 for(const patch of [{engineCc:1499},{sourceId:'other'},{fuel:'electric',power30MinKw:60},{powertrainKind:'electric'}, {operational:{provider:'other',sourceDisplacementLabel:'1.5'}}]){
  const out:any=restoreDubicarsDisplacement({...jac(),...patch});assert.equal(out.engineCc,undefined);assert.equal(out.power30MinKw,undefined);
 }
});

import {prepareSellerInventory} from '../apps/web/lib/catalog/prepare-seller-inventory';
import {LocalJsonStorage} from '../apps/web/lib/data';
import {resetCatalogRateCache} from '../apps/web/lib/catalog/rates';
import {compactPublicStorageOffer,searchProjectionFromOffer} from '../apps/web/lib/catalog/storage';
test('paid UAE stays seller-priced through retained rows and compact projections',async()=>{
 const previous=process.env.CATALOG_LIVE_RATE_DISABLED;process.env.CATALOG_LIVE_RATE_DISABLED='true';resetCatalogRateCache();
 const now=new Date().toISOString();
 const read=mock.method(LocalJsonStorage.prototype,'readJsonWithMeta',async(key:string)=>({found:true,value:key==='fees/exchange-rates.json'?{updatedAt:now,USD:{cbrRate:100,nominal:1,rateDate:now,rateSource:'cbr'},EUR:{cbrRate:95,nominal:1,rateDate:now,rateSource:'cbr'},AED:{cbrRate:25,nominal:1,rateDate:now,rateSource:'cbr'}}:[]}));
 try {
  const input:any={...jac(),year:2022,status:'active',powerHp:147,powerDataConfidence:'source_exact',powerDataSource:'source_listing',catalogPricingMode:'seller',sellerPriceRub:1425000,images:[],operational:{...jac().operational,sourceUrl:'https://www.dubicars.com/jac-js4-952829.html',semanticEvidence:Object.fromEntries(Object.entries({year:2022,fuel:'petrol',powertrainKind:'combustion',powerHp:147}).map(([key,value])=>[key,{source:'source_listing',status:'exact',value}]))}};
  const result=await prepareSellerInventory(input);assert.ok(result);assert.equal(result.engineCc,undefined);assert.equal(result.totalRub,null);assert.equal(result.sellerPriceRub,1425000);assert.equal(result.catalogPricingMode,'seller');
  // Retained rows stay seller-priced on refresh, regardless of their old specifications.
  for(const specimen of [
   {id:input.id,model:'JS4',year:2025,sourcePrice:57000,powerHp:147,label:'1.5',cc:1500},
   {id:'ab48d48542ae0cdc8df6a6c5',model:'S3 Plus',year:2023,sourcePrice:42000,powerHp:118,label:'1.6',cc:1600},
  ])for(const preservePublishedPrice of [false,true]){
   const candidate={...input,...specimen,operational:{...input.operational,sourceDisplacementLabel:specimen.label,semanticEvidence:{...input.operational.semanticEvidence,year:{source:'source_listing',status:'exact',value:specimen.year},powerHp:{source:'source_listing',status:'exact',value:specimen.powerHp}}}};
   const prepared=await prepareSellerInventory(candidate,{preservePublishedPrice});assert.ok(prepared);
   const preview=searchProjectionFromOffer(compactPublicStorageOffer(prepared));
   assert.equal(preview.engineCc,undefined);
   assert.equal(preview.catalogPricingMode,'seller');
   assert.equal(preview.sellerPriceRub,specimen.sourcePrice*25);
   assert.equal(preview.totalRub,prepared.totalRub);
   assert.equal(catalogOfferVisibleRub(preview),0);
  }
  const {calculateCustomerParameterScenario,calculateOfferWithRussiaCustoms}=await import('../apps/web/lib/catalog/customs-pricing');
  const automatic=await calculateOfferWithRussiaCustoms({...input,engineCc:1500});
  assert.equal(automatic.totalRub,null);assert.equal(automatic.engineCc,undefined);assert.equal(automatic.powerHp,undefined);
  const manual=await calculateCustomerParameterScenario(input,{year:2022,engineCc:1500,powerHp:147,powerKw:147/1.35962,fuel:'petrol',powertrainKind:'combustion'});
  assert.equal(manual.engineCc,1500);assert.equal(manual.powerHp,147);assert.ok(Number(manual.totalRub)>1425000,JSON.stringify(manual.calculationSnapshot));
  const incompleteManual=await calculateCustomerParameterScenario({...input,engineCc:1500},{year:2022,fuel:'petrol',powertrainKind:'combustion'});
  assert.equal(incompleteManual.engineCc,undefined);assert.equal(incompleteManual.powerHp,undefined);assert.equal(incompleteManual.totalRub,null);
  const {offerParameterDraft}=await import('../apps/web/lib/catalog/offer-parameter-draft');
  const draft=offerParameterDraft({...input,engineCc:1500});assert.equal(draft.engineCc,'');assert.equal(draft.powerHp,'');assert.equal(draft.powerKw,'');
  delete input.powerHp;delete input.powerDataConfidence;delete input.powerDataSource;delete input.operational.semanticEvidence.powerHp;
  const incomplete=await prepareSellerInventory(input);assert.ok(incomplete);assert.equal(incomplete.engineCc,undefined);assert.equal(incomplete.powerHp,undefined);assert.equal(incomplete.totalRub,null);assert.equal(incomplete.catalogPricingMode,'seller');
  const pendingPreview=searchProjectionFromOffer(compactPublicStorageOffer(incomplete));
  assert.equal(pendingPreview.catalogPricingMode,'seller');
  assert.equal(pendingPreview.engineCc,undefined);
 }finally{read.mock.restore();resetCatalogRateCache();if(previous===undefined)delete process.env.CATALOG_LIVE_RATE_DISABLED;else process.env.CATALOG_LIVE_RATE_DISABLED=previous;}
});

test('stale compact UAE prices cannot survive the policy while saved manual previews remain separate',()=>{
 const preview={version:'manual',totalRub:2000000,parameters:{engineCc:2700,powerHp:163}};
 const input:any={...jac(),cardProjectionVersion:3,engineCc:2700,powerHp:160,powerKw:118,totalRub:2200000,publicVisibleRub:2200000,publicSpecificationVerified:true,deliveredCalculationPreview:{totalRub:2200000},savedCalculationPreview:preview,calculationSnapshot:{currencyRate:{rateSource:'cbr',currency:'AED',sourcePrice:57000,effectiveRate:25,rateDate:new Date().toISOString()},customsInput:{engineCc:2700,powerHp:160}}};
 const out:any=safePublicPricing(input);
 assert.equal(out.totalRub,null);assert.equal(out.publicVisibleRub,undefined);assert.equal(out.deliveredCalculationPreview,undefined);assert.equal(out.engineCc,undefined);assert.equal(out.powerHp,undefined);assert.equal(out.sellerPriceRub,1425000);assert.equal(out.calculationSnapshot.customsInput,undefined);assert.equal(out.savedCalculationPreview,preview);
 assert.equal(input.powerHp,160);
});
