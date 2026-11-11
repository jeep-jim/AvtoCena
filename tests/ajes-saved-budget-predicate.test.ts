import test from 'node:test';
import assert from 'node:assert/strict';
import {ajesResultFilter} from '../apps/web/lib/catalog/ajes-result-filter';
import {offerWithSavedPreview} from '../apps/web/lib/catalog/saved-calculation-preview';
import {priceCardForCity} from '../apps/web/lib/catalog/card-city-delivery';
import {hasModificationSelection,modificationBinding} from '../apps/web/lib/catalog/modification-contract';

const savedOffer=(market:string)=>({
 id:'saved-budget-fixture',market,catalogPricingMode:'seller',sellerPriceRub:500000,totalRub:null,
 powerHp:180,savedCalculationPreview:{version:'confirmed',totalRub:1450000,deliveryCity:'',
  parameters:{powerHp:150},deliveryPricingBasis:{subtotalRub:1450000,deliveryRub:120000,percents:[2]}},
});

for(const market of ['japan','korea']){
 test(`${market}: budget matches the already attached saved quote without changing source facts`,()=>{
  const offer=savedOffer(market),before=structuredClone(offer);
  assert.equal(ajesResultFilter({market,budgetTo:1500000}).matches(offer),true);
  assert.equal(ajesResultFilter({market,budgetTo:1449999}).matches(offer),false);
  assert.equal(ajesResultFilter({market,budgetFrom:1450000,budgetTo:1450000}).matches(offer),true);
  assert.equal(ajesResultFilter({market,hasPrice:'yes'}).matches(offer),true);
  assert.equal(ajesResultFilter({market,hasPrice:'no'}).matches(offer),false);
  assert.deepEqual(offer,before);
 });

 test(`${market}: city bounds use the card's same delivery replay and reject an unknown city`,()=>{
  const offer=savedOffer(market);
  for(const city of ['Новокузнецк','Новосибирск','Москва']){
   const visible=priceCardForCity(offerWithSavedPreview(offer),city);
   assert.equal(visible.included,true);
   const amount=visible.offer.totalRub;
   assert.equal(ajesResultFilter({market,city,budgetFrom:amount,budgetTo:amount}).matches(offer),true);
   assert.equal(ajesResultFilter({market,city,budgetTo:amount-1}).matches(offer),false);
  }
  assert.equal(ajesResultFilter({market,city:'Неизвестный город',budgetTo:1500000}).matches(offer),false);
  const withoutBasis={...offer,savedCalculationPreview:{...offer.savedCalculationPreview,deliveryPricingBasis:undefined}};
  assert.equal(ajesResultFilter({market,city:'Новокузнецк',budgetTo:1500000}).matches(withoutBasis),false);
 });

 test(`${market}: a saved price never supplies missing horsepower eligibility`,()=>{
  for(const powerHp of [undefined,null,0,180]){
   const offer={...savedOffer(market),powerHp};
   assert.equal(ajesResultFilter({market,powerTo:160,budgetTo:1500000}).matches(offer),false);
  }
  assert.equal(ajesResultFilter({market,powerTo:160,budgetTo:1500000}).matches({...savedOffer(market),powerHp:150}),true);
 });
}

test('the saved card quote takes precedence over an older total and a selected scenario',()=>{
 const source={...savedOffer('korea'),totalRub:2000000,sourcePrice:10000000,sourceCurrency:'KRW',
  recoveryQualification:{status:'selection_required'}};
 const offer={...source,modificationSelection:{version:1,status:'selection_required',binding:modificationBinding(source),
  options:[{id:'version-a',label:'Confirmed scenario',market:'korea',fuel:'petrol',powertrainKind:'combustion',
   engineCc:1500,powerHp:150,powerKw:150*0.73549875,evidenceIds:['fixture']} ]}};
 assert.equal(hasModificationSelection(offer),true);
 assert.equal(ajesResultFilter({market:'korea',budgetTo:1500000}).matches(offer),true);
 assert.equal(ajesResultFilter({market:'korea',budgetFrom:1500000}).matches(offer),false);
 assert.equal(offer.totalRub,2000000);
});

test('invalid saved prices and seller-only amounts never qualify as delivered totals',()=>{
 const filter=ajesResultFilter({market:'korea',budgetTo:1500000});
 for(const totalRub of [undefined,null,0,-1,NaN,Infinity]){
  const offer={...savedOffer('korea'),totalRub:500000,
   savedCalculationPreview:{...savedOffer('korea').savedCalculationPreview,totalRub}};
  assert.equal(filter.matches(offer),false);
 }
 assert.equal(filter.matches({market:'korea',catalogPricingMode:'seller',sellerPriceRub:500000,totalRub:500000}),false);
 assert.equal(filter.matches({market:'korea',catalogPricingMode:'seller',deliveredCalculationPreview:{totalRub:1450000}}),true);
 assert.equal(filter.matches({market:'japan',catalogPricingMode:'seller',japanDeliveredPreview:{totalRub:1450000}}),true);
});

test('an invalid city replay never falls back to the saved baseline price',()=>{
 for(const market of ['japan','korea']){
  for(const deliveryPricingBasis of [
   {subtotalRub:NaN,deliveryRub:120000,percents:[2]},
   {subtotalRub:Infinity,deliveryRub:120000,percents:[2]},
   {subtotalRub:1450000,deliveryRub:1570000,percents:[]},
   {subtotalRub:1450000,deliveryRub:2000000,percents:[]},
  ]){
   const offer={...savedOffer(market),savedCalculationPreview:{...savedOffer(market).savedCalculationPreview,deliveryPricingBasis}};
   const city='Новокузнецк';
   assert.equal(ajesResultFilter({market,city,budgetTo:1500000}).matches(offer),false);
   assert.equal(ajesResultFilter({market,city,hasPrice:'yes'}).matches(offer),false);
   assert.equal(ajesResultFilter({market,city,hasPrice:'no'}).matches(offer),true);
   assert.equal(ajesResultFilter({market,budgetTo:1500000}).matches(offer),true);
  }
 }
});

test('China retains the accepted legacy predicate even when a saved preview is present',()=>{
 // This guard intentionally freezes the accepted a182 China behavior; the
 // isolated JP/KR correction must not bring main's wider price patch with it.
 const offer=savedOffer('china'),filter=ajesResultFilter({market:'china',budgetTo:1500000});
 assert.equal(filter.matches(offer),false);
 assert.equal(filter.matches({...offer,totalRub:1400000}),true);
 assert.equal(filter.matches({...offer,totalRub:2000000}),false);
 assert.equal(ajesResultFilter({market:'china',hasPrice:'yes'}).matches(offer),false);
});
