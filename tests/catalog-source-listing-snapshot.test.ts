import test from 'node:test';
import assert from 'node:assert/strict';
import { sourceListingSnapshot } from '../apps/web/lib/catalog/source-listing-snapshot';
import type { VehicleOffer } from '../apps/web/lib/catalog/types';

test('incomplete source observations survive independently of delivered price and later mutation', () => {
  const offer = { id:'one',sourceId:'test',sourceOfferId:'one',market:'georgia',make:'Toyota',model:'Prius',year:2024,
    status:'active',sourcePrice:15000,sourceCurrency:'USD',images:[],powerHp:undefined,engineCc:undefined,
    totalRub:2000000,previousTotalRub:2100000,priceDeltaRub:-100000,calculationStatus:'ready',
    calculationSnapshot:{customs:{status:'ready'}},operational:{sourceUrl:'https://example.com/one',raw:{fuel:'Hybrid'}} } as VehicleOffer;
  const result = sourceListingSnapshot(offer,'listing');
  offer.operational.raw = {fuel:'Petrol'};
  assert.equal(result.offer.totalRub,null);
  assert.equal(result.offer.calculationSnapshot,undefined);
  assert.equal(result.offer.previousTotalRub,undefined);
  assert.equal(result.offer.powerHp,undefined);
  assert.equal(result.publicationReady,false);
  assert.deepEqual(result.offer.operational.raw,{fuel:'Hybrid'});
  assert.equal(result.offer.sourcePrice,15000);
  assert.equal(offer.totalRub,2000000);
});
