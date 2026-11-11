import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultShowcase,normalizeShowcase} from '../apps/web/lib/dealers/showcase-model';
import {publicDealerProfile} from '../apps/web/lib/dealers/public-profile';
import {dealerMarkets} from '../apps/web/lib/dealers/catalog-markets';
test('dealer selects only supported markets without duplicates',()=>{
 assert.deepEqual(dealerMarkets(['korea','korea','unknown','japan']),['japan','korea']);
 const s=defaultShowcase('independent','Company');s.catalogMarkets=['korea','china'];
 const saved=normalizeShowcase(s,s.dealerId,1);
 assert.deepEqual(saved.catalogMarkets,['china','korea']);
 assert.deepEqual(publicDealerProfile(saved).catalogMarkets,['china','korea']);
 assert.equal(saved.offers.length,0);
 assert.equal('phone' in publicDealerProfile(saved),false);
});
test('empty dealer directions remain empty and pilot legacy settings preserve all markets',()=>{
 assert.deepEqual(defaultShowcase('independent').catalogMarkets,[]);
 const s=defaultShowcase('dealer_topavto');
 assert.equal(normalizeShowcase({...s,catalogMarkets:undefined},s.dealerId,1).catalogMarkets.length,6);
 assert.deepEqual(normalizeShowcase({...s,catalogMarkets:[]},s.dealerId,1).catalogMarkets,[]);
});

import {normalizeDealerServicePricing} from '../apps/web/lib/dealers/service-pricing';
import {dealerBrowsingHref,type DealerBrowsingContext} from '../apps/web/lib/dealers/browsing-context';
test('service prices cannot alter platform or own-vehicle calculation settings',()=>{
 const s=defaultShowcase('dealer_topavto');const before=structuredClone(s.pricing);
 const saved=normalizeShowcase({...s,servicePricing:{korea:{commission:{enabled:true,priceRub:123456},customs:{enabled:true,priceRub:1},currencyRate:1},unknown:{delivery:{enabled:true,priceRub:2}}}},s.dealerId,1);
 assert.deepEqual(saved.pricing,before);
 assert.deepEqual(saved.servicePricing,{korea:{commission:{enabled:true,priceRub:123456}}});
 assert.equal('servicePricing' in publicDealerProfile(saved),false);
 assert.throws(()=>normalizeDealerServicePricing({japan:{delivery:{enabled:true,priceRub:-1}}}),/стоимость/);
 assert.throws(()=>normalizeDealerServicePricing({japan:{delivery:{enabled:true,priceRub:'bad'}}}),/стоимость/);
});
const context:DealerBrowsingContext={id:'dealer_topavto',name:'TopAvto',logoLight:'',logoDark:'',href:'/nvkz/topavto',preview:false,markets:['japan','korea']};
test('dealer URLs retain filters, pages, saved calculations and explicit exit',()=>{
 assert.equal(dealerBrowsingHref('/cars?market=korea&yearFrom=2020&page=3',context),'/nvkz/topavto?market=korea&yearFrom=2020&page=3');
 assert.equal(dealerBrowsingHref('/cars/offer/test?calculation=v2',context),'/cars/offer/test?calculation=v2&dealer=dealer_topavto');
 assert.equal(dealerBrowsingHref('/request',context),'/request?dealer=dealer_topavto');
 assert.equal(dealerBrowsingHref('/',context),'/');
 assert.equal(dealerBrowsingHref('https://example.com/cars',context),'https://example.com/cars');
 assert.equal(dealerBrowsingHref('/cars',null),'/cars');
 const preview={...context,href:'/dealers/dealer_topavto?preview=1',preview:true};
 assert.equal(dealerBrowsingHref('/cars?market=japan',preview),'/dealers/dealer_topavto?preview=1&market=japan');
 assert.equal(dealerBrowsingHref('/cars/offer/test',preview),'/cars/offer/test?dealer=dealer_topavto&preview=1');
});
