import assert from 'node:assert/strict';
import test from 'node:test';
import {permitsFixedMarketModelYear,catalogInventoryAgeDecision} from '../apps/web/lib/catalog/inventory-admission';
import {isCatalogYearAllowed,isPreservedCatalogYearAllowed} from '../apps/web/lib/catalog/offer-quality';

test('Europe and Korea rebuilds enforce the agreed 2022 model year on archived and new observations',()=>{
 for(const market of ['europe','korea']){
  for(const year of [2020,2021]){
   assert.equal(permitsFixedMarketModelYear(market,year),false);
   assert.equal(isCatalogYearAllowed(year,market),false);
   assert.equal(catalogInventoryAgeDecision({market,year,productionDate:'2025-01-01'},new Date('2026-11-21T00:00:00Z')).eligible,false);
  }
  assert.equal(permitsFixedMarketModelYear(market,2022),true);
  assert.equal(isCatalogYearAllowed(2022,market),true);
 }
 assert.equal(isPreservedCatalogYearAllowed(2021,'korea'),true);
 assert.equal(isPreservedCatalogYearAllowed('unknown','korea'),false);
 assert.equal(permitsFixedMarketModelYear('japan',2020),true);
 assert.equal(permitsFixedMarketModelYear('china',2015),true);
});
