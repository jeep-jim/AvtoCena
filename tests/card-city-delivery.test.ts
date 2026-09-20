import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateAvtocenaFromBusinessConfig} from '../packages/engine/src/calculation/calculateAvtocena';
import {priceCardForCity,deliveryPricingBasis} from '../apps/web/lib/catalog/card-city-delivery';
import {quoteCityDelivery} from '../apps/web/lib/catalog/city-delivery';
import {compactPricingSnapshot} from '../apps/web/lib/catalog/compact-pricing-snapshot';

test('card delivery equals the full engine for all markets, including independently rounded percentages',()=>{
 for (const market of ['japan','china','korea','georgia','uae','europe']) {
  const config:any={percentExpenses:[{id:'fee',title:'fee',percent:1.333},{id:'fee2',title:'fee2',percent:0.27}],exchangeRateReservePercent:2};
  const calculate=(city:string)=>calculateAvtocenaFromBusinessConfig({marketId:market,marketConfig:config,sourcePriceRub:1234567,customsRub:654321,cityDeliveryRub:quoteCityDelivery(city,market).amountRub,deliveryCity:city});
  for (const originalCity of ['', 'Москва']) {
   const initial=calculate(originalCity);
   const offer={market,totalRub:initial.totalRub,calculationSnapshot:initial.snapshot};
   for (const city of ['', 'Чита','Москва','Астрахань','Неизвестный']) {
    const priced=priceCardForCity(offer,city);
    assert.equal(priced.offer.totalRub,calculate(city).totalRub,`${market}/${originalCity}/${city}`);
    assert.equal(priced.included,quoteCityDelivery(city,market).status==='estimated');
   }
   assert.equal(offer.totalRub,initial.totalRub,'input stays unchanged');
   const compact={...offer,calculationSnapshot:{deliveryPricingBasis:deliveryPricingBasis(initial.snapshot)}};
   assert.equal(priceCardForCity(compact,'Чита').offer.totalRub,calculate('Чита').totalRub);
  }
 }
});

test('Japan preview keeps source price separate; missing basis never claims included delivery',()=>{
 const basis={subtotalRub:1000000,deliveryRub:0,percents:[]};
 const offer={market:'japan',catalogPricingMode:'seller',sellerPriceRub:200000,totalRub:null,japanDeliveredPreview:{totalRub:1000000,deliveryPricingBasis:basis}};
 const result=priceCardForCity(offer,'Чита');
 assert.equal(result.offer.japanDeliveredPreview.totalRub,1065000);
 assert.equal(result.offer.sellerPriceRub,200000);
 assert.equal(result.included,true);
 assert.equal(priceCardForCity({...offer,japanDeliveredPreview:null},'Чита').included,false);
 assert.equal(priceCardForCity({market:'korea',totalRub:1000000},'Чита').included,false);
});

test('compact snapshots preserve delivery replay basis and prefer fresh ledger over stale basis',()=>{
 const snapshot:any={customsInput:{},marketConfig:{percentExpenses:[]},deliveryPricingBasis:{subtotalRub:1,deliveryRub:999,percents:[]},breakdown:[{id:'car',amountRub:1000000},{id:'rf-delivery',amountRub:65000}]};
 const compact=compactPricingSnapshot({market:'korea',calculationSnapshot:snapshot} as any);
 assert.deepEqual(compact.deliveryPricingBasis,{subtotalRub:1065000,deliveryRub:65000,percents:[]});
});
