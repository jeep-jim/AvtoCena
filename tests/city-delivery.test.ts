import test from 'node:test';
import assert from 'node:assert/strict';
import {quoteCityDelivery,deliveryDescription} from '../apps/web/lib/catalog/city-delivery';
import {resolveCatalogMarketConfig} from '../apps/web/lib/catalog/estimated-market-config';
import {calculateAvtocenaFromBusinessConfig} from '../packages/engine/src/calculation/calculateAvtocena';
import {validateCustomerParameters} from '../apps/web/lib/catalog/customer-parameters';
import {applyJapanServiceCosts,japanServiceCostBasis} from '../apps/web/lib/catalog/japan-service-pricing';

test('owner anchors, rounded estimates and explicit no-delivery state',()=>{
 assert.equal(quoteCityDelivery('Новосибирск','japan').amountRub,130000);
 assert.equal(quoteCityDelivery(' г. Новокузнецк ','korea').amountRub,120000);
 assert.equal(quoteCityDelivery('Москва','china').amountRub,200000);
 for(const city of ['Москва','Хабаровск','Иркутск','Казань','Санкт-Петербург']) assert.equal(quoteCityDelivery(city).amountRub%5000,0);
 assert.equal(quoteCityDelivery('').status,'not_selected');
 assert.match(deliveryDescription(quoteCityDelivery('')),/не включена/);
 assert.equal(quoteCityDelivery('Владивосток').amountRub,0);
 for(const city of ['Неизвестный город','constructor','__proto__']) assert.equal(quoteCityDelivery(city).status,'needs_quote');
 assert.equal(quoteCityDelivery('Москва','georgia').status,'needs_quote');
});

test('city cost replaces legacy delivery once and participates in percentages and payment balance',()=>{
 const config=resolveCatalogMarketConfig('china',{rfDeliveryRub:120000,percentExpenses:[{id:'fee',title:'fee',percent:1}]}).config;
 assert.equal(config.rfDeliveryRub,0);
 const calculate=(city:string)=>calculateAvtocenaFromBusinessConfig({marketId:'china',marketConfig:config,sourcePriceRub:1000000,customsRub:500000,cityDeliveryRub:quoteCityDelivery(city,'china').amountRub,deliveryCity:city});
 const base=calculate(''),nsk=calculate('Новосибирск'),nvk=calculate('Новокузнецк');
 assert.equal(nsk.totalRub-base.totalRub,131300);
 assert.equal(nvk.totalRub-base.totalRub,121200);
 assert.equal(nsk.breakdown.filter(row=>row.id==='rf-delivery').length,1);
 assert.equal(nsk.paymentPlan.remainingAfterInitialRub-base.paymentPlan.remainingAfterInitialRub,131300);
 assert.equal(nsk.paymentPlan.contractInitialPaymentRub,base.paymentPlan.contractInitialPaymentRub);
 assert.equal(nsk.breakdown.at(-1)?.id,'exchange-reserve');
 assert.equal(calculate('').totalRub,base.totalRub);
});

test('API parameters retain city but cannot inject a delivery amount',()=>{
 const result=validateCustomerParameters({year:2020,fuel:'petrol',powerHp:150,engineCc:2000,deliveryCity:' г. Москва ',cityDeliveryRub:-900000});
 assert.equal(result.deliveryCity,'Москва');
 assert.equal((result as any).cityDeliveryRub,undefined);
});

test('old Japan snapshot loses only saved delivery and repricing is idempotent',()=>{
 const config={serviceBundleVersion:1,topAvtoCommissionRub:90000,laboratoryRub:50000,securityDepositRub:160000,exchangeRateReservePercent:2};
 const breakdown=[{id:'car',amountRub:1000000},{id:'laboratory',amountRub:50000},{id:'topavto-commission',amountRub:90000},{id:'rf-delivery',amountRub:120000},{id:'exchange-reserve',amountRub:20000}];
 const offer:any={totalRub:1280000,calculationSnapshot:{breakdown}};
 assert.equal(japanServiceCostBasis(offer.calculationSnapshot)?.rfDeliveryRub,120000);
 const updated=applyJapanServiceCosts(offer,config);
 assert.equal(updated.totalRub,1160000);
 assert.equal(applyJapanServiceCosts(updated,config).totalRub,1160000);
 assert.ok(!updated.calculationSnapshot.breakdown.some((row:any)=>row.id==='rf-delivery'));
});
