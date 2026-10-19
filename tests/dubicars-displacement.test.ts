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
test('saved JAC gets volume in display, normalization and publication without changing price or observation',()=>{
 const input=jac();
 for(const restore of [restoreDubicarsDisplacement,safePublicPricing,normalizeVehicleOfferSpecs,inventorySourceEvidence]){
  const out:any=restore(input as any);assert.equal(out.engineCc,1500);assert.equal(out.sourcePrice,57000);assert.equal(out.updatedAt,input.updatedAt);assert.equal(out.operational.sourceDisplacementLabel,'1.5');assert.equal(out.operational.semanticEvidence.engineCc.sourceUnit,'L');assert.equal(out.powerHp,undefined);
 }
 assert.equal(input.engineCc,undefined);const restored=restoreDubicarsDisplacement(input);assert.equal(restoreDubicarsDisplacement(restored),restored);
});
test('explicit values, other sources and electric engines are unchanged',()=>{
 for(const patch of [{engineCc:1499},{market:'china'},{sourceId:'other'},{fuel:'electric'},{powertrainKind:'electric'},{operational:{provider:'other',sourceDisplacementLabel:'1.5'}}]){
  const input={...jac(),...patch};assert.equal(restoreDubicarsDisplacement(input),input);
 }
});

import {prepareSellerInventory} from '../apps/web/lib/catalog/prepare-seller-inventory';
import {LocalJsonStorage} from '../apps/web/lib/data';
import {resetCatalogRateCache} from '../apps/web/lib/catalog/rates';
import {compactPublicStorageOffer,searchProjectionFromOffer} from '../apps/web/lib/catalog/storage';
test('saved paid UAE seller offer recalculates with complete evidence and stays incomplete without power',async()=>{
 const previous=process.env.CATALOG_LIVE_RATE_DISABLED;process.env.CATALOG_LIVE_RATE_DISABLED='true';resetCatalogRateCache();
 const now=new Date().toISOString();
 const read=mock.method(LocalJsonStorage.prototype,'readJsonWithMeta',async(key:string)=>({found:true,value:key==='fees/exchange-rates.json'?{updatedAt:now,USD:{cbrRate:100,nominal:1,rateDate:now,rateSource:'cbr'},EUR:{cbrRate:95,nominal:1,rateDate:now,rateSource:'cbr'},AED:{cbrRate:25,nominal:1,rateDate:now,rateSource:'cbr'}}:[]}));
 try {
  const input:any={...jac(),year:2022,status:'active',powerHp:147,powerDataConfidence:'source_exact',powerDataSource:'source_listing',catalogPricingMode:'seller',sellerPriceRub:1425000,images:[],operational:{...jac().operational,sourceUrl:'https://www.dubicars.com/jac-js4-952829.html',semanticEvidence:Object.fromEntries(Object.entries({year:2022,fuel:'petrol',powertrainKind:'combustion',powerHp:147}).map(([key,value])=>[key,{source:'source_listing',status:'exact',value}]))}};
  const result=await prepareSellerInventory(input);assert.ok(result);assert.equal(result.engineCc,1500);assert.ok(Number(result.totalRub)>1425000,JSON.stringify(result));assert.equal(result.catalogPricingMode,undefined);
  // The publisher also replays retained seller rows. Both JAC examples must
  // carry the calculated amount through storage into the catalog preview.
  for(const specimen of [
   {id:input.id,model:'JS4',year:2025,sourcePrice:57000,powerHp:147,label:'1.5',cc:1500},
   {id:'ab48d48542ae0cdc8df6a6c5',model:'S3 Plus',year:2023,sourcePrice:42000,powerHp:118,label:'1.6',cc:1600},
  ])for(const preservePublishedPrice of [false,true]){
   const candidate={...input,...specimen,operational:{...input.operational,sourceDisplacementLabel:specimen.label,semanticEvidence:{...input.operational.semanticEvidence,year:{source:'source_listing',status:'exact',value:specimen.year},powerHp:{source:'source_listing',status:'exact',value:specimen.powerHp}}}};
   const prepared=await prepareSellerInventory(candidate,{preservePublishedPrice});assert.ok(prepared);
   const preview=searchProjectionFromOffer(compactPublicStorageOffer(prepared));
   assert.equal(preview.engineCc,specimen.cc);
   assert.equal(preview.catalogPricingMode,undefined);
   assert.ok(Number(preview.totalRub)>specimen.sourcePrice*25);
   assert.equal(preview.totalRub,prepared.totalRub);
   assert.equal(preview.publicVisibleRub,prepared.totalRub);
  }
  delete input.powerHp;delete input.powerDataConfidence;delete input.powerDataSource;delete input.operational.semanticEvidence.powerHp;
  const incomplete=await prepareSellerInventory(input);assert.ok(incomplete);assert.equal(incomplete.engineCc,1500);assert.equal(incomplete.powerHp,undefined);assert.equal(incomplete.totalRub,null);assert.equal(incomplete.catalogPricingMode,'seller');
  const pendingPreview=searchProjectionFromOffer(compactPublicStorageOffer(incomplete));
  assert.equal(pendingPreview.catalogPricingMode,'seller');
  assert.equal(pendingPreview.engineCc,1500);
 }finally{read.mock.restore();resetCatalogRateCache();if(previous===undefined)delete process.env.CATALOG_LIVE_RATE_DISABLED;else process.env.CATALOG_LIVE_RATE_DISABLED=previous;}
});
