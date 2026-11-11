import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeWorldAutoSearchPayload } from '../scripts/catalog-source-worldauto-search-endpoint-probe-v1.mjs';

test('summarizes public vehicle fields while excluding contact-like fields', () => {
  const payload = {
    data: {
      items: [{
        id: 123,
        price: 14500,
        currency: 'USD',
        year: 2022,
        mileage: 42000,
        engineVolume: 2.0,
        power: 150,
        model: 'Example',
        images: ['a.jpg','b.jpg'],
        sellerName: 'Private Person',
        phone: '+995000000000',
      }],
      total: 1,
    },
  };
  const summary = summarizeWorldAutoSearchPayload(payload);
  assert.equal(summary.sampleItemPath, 'data.items');
  const paths = summary.candidateVehicleFields.map((row) => row.path);
  assert.ok(paths.includes('item.price'));
  assert.ok(paths.includes('item.engineVolume'));
  assert.ok(paths.includes('item.power'));
  assert.ok(paths.includes('item.images'));
  assert.equal(paths.some((path) => /seller|phone/i.test(path)), false);
});

test('handles a root array payload', () => {
  const summary = summarizeWorldAutoSearchPayload([{ advertId: 7, year: 2024, photo: 'x' }]);
  assert.equal(summary.sampleItemPath, '$');
  assert.ok(summary.candidateVehicleFields.some((row) => row.path === 'item.advertId'));
});
