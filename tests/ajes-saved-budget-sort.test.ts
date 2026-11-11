import test from 'node:test';
import assert from 'node:assert/strict';
import {sortCatalogRows} from '../apps/web/lib/catalog/market-page';
import {offerWithSavedPreview} from '../apps/web/lib/catalog/saved-calculation-preview';
import {priceCardForCity} from '../apps/web/lib/catalog/card-city-delivery';
test('delivered price sort follows the same saved quote and city replay as visible cards',()=>{
 const rows=[{id:'a',market:'korea',catalogPricingMode:'seller',totalRub:900000,savedCalculationPreview:{totalRub:1450000,parameters:{},deliveryPricingBasis:{subtotalRub:1450000,deliveryRub:120000,percents:[]}}},
  {id:'b',market:'korea',catalogPricingMode:'seller',totalRub:2000000,savedCalculationPreview:{totalRub:1300000,parameters:{},deliveryPricingBasis:{subtotalRub:1300000,deliveryRub:120000,percents:[]}}}];
 const before=structuredClone(rows),city='Новокузнецк';
 const expected=[...rows].sort((a,b)=>priceCardForCity(offerWithSavedPreview(a),city).offer.totalRub-priceCardForCity(offerWithSavedPreview(b),city).offer.totalRub);
 assert.deepEqual(sortCatalogRows(rows,'totalRub',city).map(x=>x.id),expected.map(x=>x.id));
 assert.deepEqual(sortCatalogRows(rows,'totalRubDesc',city).map(x=>x.id),expected.map(x=>x.id).reverse());
 assert.deepEqual(rows,before);
});
