import { calculateRussiaCustomsForIndividual as publicEngine } from "../packages/engine/src/index";
import { validateMarketVersion } from "../apps/web/lib/settings-validation";
import { expandCustomsBreakdown } from "../apps/web/lib/catalog/customs-breakdown";
import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateRussiaCustomsForIndividual as calc, legalProductionReference } from '../packages/engine/src/calculation/russiaCustomsV2';
import { validateCustomerParameters } from '../apps/web/lib/catalog/customer-parameters';
import { selectActiveMarketVersion } from '../apps/web/lib/business-settings';
import { repriceOfferWithBusinessConfig } from '../apps/web/lib/catalog/live-business-pricing';
import { calculateAvtocenaFromBusinessConfig } from '../packages/engine/src/calculation/calculateAvtocena';
import { CATALOG_MARKET_DEFAULTS } from '../apps/web/lib/catalog/estimated-market-config';
const date=new Date('2026-09-09T00:00:00Z');
const base={customsValueRub:2_000_000,eurRateRub:100,engineCc:2499,fuel:'diesel',powertrainKind:'combustion' as const,productionDate:'2021-09-08',vehicleCategory:'N1' as const,grossVehicleWeightKg:3200,importedAt:date};
const config:any={...CATALOG_MARKET_DEFAULTS.china,id:'test',status:'active',active:true,provisional:false};
test('N1 diesel: actual duty, VAT and mass-based recycling; no passenger privilege or excise',()=>{
 const result=calc(base);assert.equal(result.status,'ready');assert.equal(result.tariffCode,'8704219802');
 assert.equal(result.importDutyRub,200000);assert.equal(result.vatRub,484000);assert.equal(result.exciseRub,0);
 assert.equal(result.utilizationFeeRub,1441500);assert.equal(result.knownCustomsRub,697541);assert.equal(result.totalCustomsRub,2139041);
 assert.equal(calc({...base,powerHp:800,personalUseEligible:true}).totalCustomsRub,result.totalCustomsRub);
});
test('mass threshold is full 2500/2501 kg, not power; invalid N1 mass blocks',()=>{
 assert.equal(calc({...base,grossVehicleWeightKg:2500}).utilizationFeeRub,1336500);
 assert.equal(calc({...base,grossVehicleWeightKg:2501}).utilizationFeeRub,1441500);
 for(const grossVehicleWeightKg of [0,-1,3501,NaN]) assert.equal(calc({...base,grossVehicleWeightKg}).status,'needs_data');
});
test('diesel 5/7-year exact boundaries and cc minimum',()=>{
 const cheap={...base,customsValueRub:100000};
 assert.equal(calc({...cheap,productionDate:'2021-09-09'}).importDutyRub,10000);
 assert.equal(calc({...cheap,productionDate:'2021-09-08'}).importDutyRub,32487);
 assert.equal(calc({...cheap,productionDate:'2019-09-09'}).importDutyRub,32487);
 assert.equal(calc({...cheap,productionDate:'2019-09-08'}).importDutyRub,249900);
 assert.equal(calc({...cheap,engineCc:2501,productionDate:'2021-09-08'}).importDutyRub,10000);
});
test('new spark-ignition tariff is 12.5% above 2800 cc, 15% at 2800; exactly 3 years is used for duty',()=>{
 const petrol={...base,fuel:'petrol',engineCc:3000,productionDate:'2023-09-10'};
 assert.equal(calc(petrol).importDutyRub,250000);assert.equal(calc({...petrol,engineCc:2800}).importDutyRub,300000);
 assert.equal(calc({...petrol,productionDate:'2023-09-09'}).importDutyRub,300000);
 assert.equal(calc({...petrol,productionDate:'2023-09-09'}).utilizationFeeRub,990000);
 assert.equal(calc({...petrol,productionDate:'2023-09-08'}).utilizationFeeRub,1441500);
});
test('BEV/series N1 is 15%; parallel hybrid needs ICE fuel and certified relative power',()=>{
 assert.equal(calc({...base,powertrainKind:'electric',fuel:'electric',engineCc:undefined}).importDutyRub,300000);
 assert.equal(calc({...base,powertrainKind:'series_hybrid',fuel:'hybrid'}).importDutyRub,300000);
 const hybrid={...base,powertrainKind:'other_hybrid' as const,fuel:'hybrid',n1IceFuel:'diesel' as const,icePowerKw:120,power30MinKw:80};
 assert.equal(calc(hybrid).importDutyRub,200000);assert.equal(calc({...hybrid,power30MinKw:120}).importDutyRub,300000);
 assert.equal(calc({...hybrid,power30MinKw:undefined,powerHp:500}).status,'needs_data');
});
test('classification, future dates and unsupported rate years never receive an arbitrary total',()=>{
 assert.equal(calc({...base,tnVedCode:'8703'}).status,'needs_data');
 assert.equal(calc({...base,vehicleCategory:'M1',tnVedCode:'8704'}).status,'needs_data');
 assert.equal(calc({...base,productionDate:'2027-01-01'}).status,'needs_data');
 assert.equal(calc({...base,importedAt:new Date('2027-01-01')}).status,'needs_data');
 assert.equal(legalProductionReference({productionDate:'2024-02-30',year:2024}),null);
 assert.equal(legalProductionReference({productionDate:'2024-13',year:2024}),null);
});
test('manual month/day and planned clearance date survive validation; invalid calendar dates rejected',()=>{
 const draft={year:2021,productionMonth:9,productionDay:10,customsCalculationDate:'2026-09-11',fuel:'diesel',engineCc:2499,powerHp:143,vehicleCategory:'N1',grossVehicleWeightKg:3200,transportToBorderRub:0};
 const input=validateCustomerParameters(draft);assert.equal(input.productionDate,'2021-09-10');assert.equal(input.transportToBorderRub,0);
 assert.equal(input.customsCalculationDate,'2026-09-11');
 assert.throws(()=>validateCustomerParameters({...draft,productionMonth:2,productionDay:30}));
 assert.throws(()=>validateCustomerParameters({...draft,customsCalculationDate:'2026-02-30'}));
});
test('CRM versions cannot select a future, disabled or draft version through activeVersionId',()=>{
 for(const version of [{id:'x',status:'scheduled',active:true,effectiveFrom:'2099-01-01'},{id:'x',status:'draft',active:true},{id:'x',status:'active',active:false}])
 assert.equal(selectActiveMarketVersion({activeVersionId:'x',versions:[version]},date),null);
});
test('business repricing cannot manufacture a complete quote from customs clearance alone',()=>{
 const offer:any={market:'china',totalRub:null,calculationStatus:'needs_data',calculationSnapshot:{currencyRate:{sourcePriceRub:2000000},customs:{status:'needs_data',knownCustomsRub:13541,missing:['vehicle_category']}}};
 assert.deepEqual(repriceOfferWithBusinessConfig(offer,config),offer);
});
test('N1 split breakdown sums exactly and deposit is not charged twice',()=>{
 const c=calc(base);const result=calculateAvtocenaFromBusinessConfig({marketId:'china',marketConfig:config,sourcePriceRub:2000000,customsRub:c.knownCustomsRub,utilizationFeeRub:c.utilizationFeeRub});
 assert.equal(result.breakdown.filter(x=>x.kind==='customs').reduce((n,x)=>n+x.amountRub,0),c.totalCustomsRub);
 assert.equal(result.breakdown.filter(x=>['car','security-deposit'].includes(x.id)).reduce((n,x)=>n+x.amountRub,0),2000000);
 const display=expandCustomsBreakdown(result.breakdown,c);
 assert.ok(display.some(x=>x.id==='vat' && x.amountRub===484000));
 assert.equal(display.reduce((sum,x)=>sum+x.amountRub,0),result.totalRub);
});
test('M1 exact day changes tariff after 5 years, not after 6; unknown date is marked conditional',()=>{
 const m={...base,vehicleCategory:'M1' as const,engineCc:1500,powerHp:120,fuel:'petrol',productionDate:'2021-09-09'};
 assert.equal(calc(m).importDutyRub,255000);assert.equal(calc({...m,productionDate:'2021-09-08'}).importDutyRub,480000);
 assert.equal(calc({...m,productionDate:undefined,year:2021}).ageEstimated,true);
});


test("published quote replays customs when today's age crosses the saved tariff", () => {
  const today = new Date();
  const oldDate = `${today.getUTCFullYear()-6}-01-01`;
  const inputs = {customsValueRub:1000000,eurRateRub:100,engineCc:1500,powerHp:150,fuel:"petrol",productionDate:oldDate};
  const stale = calc({...inputs,productionDate:`${today.getUTCFullYear()-4}-01-01`});
  const current = calc(inputs);
  const offer:any = {market:"china",priceMode:"fixed",totalRub:2000000,calculationSnapshot:{
    customsInput:inputs,customs:stale,currencyRate:{sourcePriceRub:1000000},missing:[],priceIncludesAllCustoms:true,priceIncludesUtilizationFee:true}};
  const updated = repriceOfferWithBusinessConfig(offer,CATALOG_MARKET_DEFAULTS.china);
  assert.equal(updated.calculationSnapshot.customs.importDutyRub,current.importDutyRub);
  assert.notEqual(current.importDutyRub,stale.importDutyRub);
  assert.equal(offer.calculationSnapshot.customs.importDutyRub,stale.importDutyRub);
});

test("scheduled complete profile activates on its effective day", () => {
  const scheduled = {id:"next",status:"scheduled",active:true,effectiveFrom:"2026-09-10T00:00:00Z"};
  assert.equal(selectActiveMarketVersion({versions:[scheduled]},new Date("2026-09-09")),null);
  assert.equal(selectActiveMarketVersion({versions:[scheduled]},new Date("2026-09-10"))?.status,"active");
});

test('invalid M1 calendar input cannot fall through the legacy month parser',()=>{
 for(const productionDate of ['2021-02-29','2021-12-99','2021-13-01']) assert.equal(calc({...base,vehicleCategory:'M1',productionDate}).status,'needs_data');
});

test('N1 electric calculation does not request passenger utilization power',()=>{
 const params=validateCustomerParameters({year:2025,fuel:'electric',vehicleCategory:'N1',grossVehicleWeightKg:3200});
 assert.equal(params.power30MinKw,undefined);
 assert.equal(calc({...base,...params,productionDate:'2025-01-01'}).status,'ready');
});


test('package entry point uses the N1-aware engine',()=>{
 assert.equal(publicEngine(base).totalCustomsRub,calc(base).totalCustomsRub);
 assert.equal(publicEngine(base).vehicleCategory,'N1');
});

test('CRM rejects malformed supplied costs and dates instead of silently using defaults',()=>{
 const good={status:'active',currency:'EUR',securityDepositRub:100,topAvtoCommissionRub:100,active:true};
 for(const patch of [{logisticsRub:-1},{brokerRub:'oops'},{percentExpenses:[{id:'x',title:'X',percent:-5}]},{effectiveFrom:'invalid-date'}]) assert.equal(validateMarketVersion({...good,...patch}).ok,false);
 assert.equal(validateMarketVersion({...good,logisticsRub:0}).ok,true);
});
