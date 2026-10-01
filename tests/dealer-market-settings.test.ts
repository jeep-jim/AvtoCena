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
