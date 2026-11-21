import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const req=createRequire(import.meta.url),react=req('react');
if(!react.cache)react.cache=(f:Function)=>f;
const {projectPreparedChinaDelivery}=await import('./apps/web/lib/catalog/prepared-china-fixed-city.ts');
const rows=[{}, {id:'000000000000000000000002',market:'china',sourceOfferId:'2',sourcePrice:10000,make:'Toyota',model:'RAV4',
  year:2023,updatedAt:'2026-11-20T12:00:00Z',calculationStatus:'ready',totalRub:2001000}];
test('prepared China same-origin native pickup keeps the exact sealed before-shipment rubles and known quote metadata',async()=>{
 const {preparedChinaDeliveryQuote}=await import('./apps/web/lib/catalog/prepared-china-fixed-city.ts');
 const {quoteCityDelivery}=await import('./apps/web/lib/catalog/city-delivery.ts');
 const r=rows[1],v={...r,calculationSnapshot:{deliveryPricingBasis:{subtotalRub:r.totalRub,deliveryRub:0,percents:[]},receipt:'fixture-seal'}};
 const cmp=quoteCityDelivery('г. уссурийск','china');
 assert.deepEqual(preparedChinaDeliveryQuote('г. уссурийск'),cmp);
 assert.equal(cmp.distanceKm,0); assert.equal(cmp.amountRub,0);assert.equal(cmp.status,'estimated');
 assert.ok(preparedChinaDeliveryQuote('Москва').amountRub>0);
 assert.throws(()=>preparedChinaDeliveryQuote('неизвестная точка'),/quote_unavailable/);
 const city=projectPreparedChinaDelivery(v,'Уссурийск');
 assert.equal(city.totalRub,v.totalRub);
 assert.equal(projectPreparedChinaDelivery(city,'Уссурийск').totalRub,v.totalRub);
 assert.equal(city.updatedAt,v.updatedAt);assert.equal(city.sourceOfferId,v.sourceOfferId);
 assert.equal(city.sourcePrice,v.sourcePrice);assert.equal(city.calculationSnapshot.receipt,'fixture-seal');
});
