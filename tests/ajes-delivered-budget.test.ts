import test from 'node:test';
import assert from 'node:assert/strict';
import {ajesResultFilter} from '../apps/web/lib/catalog/ajes-result-filter';
import {offerWithSavedPreview} from '../apps/web/lib/catalog/saved-calculation-preview';
import {priceCardForCity} from '../apps/web/lib/catalog/card-city-delivery';

for (const market of ['japan','korea']) test(`${market}: 1.5m budget uses the same saved delivered quote as its card`,()=>{
 const offer={id:'fixture',market,catalogPricingMode:'seller',sellerPriceRub:500_000,totalRub:null,powerHp:180,
  savedCalculationPreview:{version:'confirmed',totalRub:1_450_000,parameters:{powerHp:150},deliveryCity:'',
   deliveryPricingBasis:{subtotalRub:1_450_000,deliveryRub:120_000,percents:[]}}};
 assert.equal(ajesResultFilter({market,budgetTo:'1500000'}).matches(offer),true);
 assert.equal(ajesResultFilter({market,budgetTo:'1449999'}).matches(offer),false);
 assert.equal(ajesResultFilter({market,budgetFrom:'1450000',budgetTo:'1500000'}).matches(offer),true);
 assert.equal(ajesResultFilter({market,hasPrice:'yes'}).matches(offer),true);
 assert.equal(ajesResultFilter({market,powerTo:'160',budgetTo:'1500000'}).matches(offer),false,'saved scenario must not change source horsepower eligibility');
 const city='Новокузнецк';
 const expected=priceCardForCity(offerWithSavedPreview(offer),city);
 assert.equal(expected.included,true);
 const amount=expected.offer.totalRub;
 assert.equal(ajesResultFilter({market,city,budgetTo:amount}).matches(offer),true);
 assert.equal(ajesResultFilter({market,city,budgetTo:amount-1}).matches(offer),false);
 assert.equal(offer.totalRub,null,'filter must not mutate source facts or the saved calculation');
});

test('seller-only, missing calculation and nonfinite amounts never pass a delivered budget',()=>{
 const filter=ajesResultFilter({market:'korea',budgetTo:'1500000'});
 assert.equal(filter.matches({market:'korea',catalogPricingMode:'seller',sellerPriceRub:500000,totalRub:500000}),false);
 for(const totalRub of [undefined,null,0,-1,NaN,Infinity])assert.equal(filter.matches({market:'korea',catalogPricingMode:'seller',savedCalculationPreview:{totalRub}}),false);
 assert.equal(filter.matches({market:'korea',catalogPricingMode:'seller',deliveredCalculationPreview:{totalRub:1450000}}),true);
 assert.equal(filter.matches({market:'japan',catalogPricingMode:'seller',japanDeliveredPreview:{totalRub:1450000}}),true);
});

test('saved quote wins over an older total and covers explicitly selected modifications',()=>{
 const offer={market:'korea',totalRub:2000000,catalogPricingMode:'seller',savedCalculationPreview:{totalRub:1450000,parameters:{}}};
 assert.equal(ajesResultFilter({market:'korea',budgetTo:1500000}).matches(offer),true);
 assert.equal(ajesResultFilter({market:'korea',budgetFrom:1500000}).matches(offer),false);
});
