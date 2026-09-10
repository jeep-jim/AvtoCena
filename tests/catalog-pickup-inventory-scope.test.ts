import assert from 'node:assert/strict';
import test from 'node:test';
import { isCommercialInventoryOffer } from '../scripts/lib/catalog-vehicle-scope.mjs';

test('pickup model and body labels do not trigger the heavy-commercial exclusion', () => {
  assert.equal(isCommercialInventoryOffer({ make: 'Ford', model: 'Ranger', bodyType: 'pickup' }), false);
  assert.equal(isCommercialInventoryOffer({ make: 'Toyota', model: 'Hilux', bodyType: 'Pickup Truck' }), false);
  assert.equal(isCommercialInventoryOffer({ make: 'Isuzu', model: 'TAGA H', bodyType: 'Пикап' }), false);
  assert.equal(isCommercialInventoryOffer({ make: 'Hino', model: 'Ranger', bodyType: 'truck' }), true);
  assert.equal(isCommercialInventoryOffer({ make: 'Isuzu', model: 'Giga', bodyType: 'truck' }), true);
  assert.equal(isCommercialInventoryOffer({ make: 'Mitsubishi Fuso', model: 'Canter' }), true);
  assert.equal(isCommercialInventoryOffer({ make: 'Ford', model: 'Transit', bodyType: 'cargo van' }), true);
});
