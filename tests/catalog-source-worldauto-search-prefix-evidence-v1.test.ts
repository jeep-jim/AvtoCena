import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extractFirstArrayObject,
  summarizeRecoveredWorldAutoItem,
} from '../scripts/catalog-source-worldauto-search-prefix-evidence-v1.mjs';

test('recovers the first balanced object from an array inside a truncated JSON prefix', () => {
  const prefix = '{"data":{"items":[{"id":1,"price":12000,"year":2021,"images":["a"]},{"id":2,"price":13000';
  const recovered = extractFirstArrayObject(prefix);
  assert.equal(recovered.found, true);
  assert.equal(recovered.value.id, 1);
  assert.equal(recovered.value.price, 12000);
});

test('summarizes vehicle-like fields and excludes contact data', () => {
  const summary = summarizeRecoveredWorldAutoItem({
    advertId: 44,
    price: 18000,
    year: 2023,
    mileage: 12000,
    engineVolume: 2.5,
    power: 190,
    images: ['a','b'],
    sellerName: 'Hidden',
    phone: '000',
  });
  const paths = summary.candidateVehicleFields.map((row) => row.path);
  assert.ok(paths.includes('item.price'));
  assert.ok(paths.includes('item.engineVolume'));
  assert.ok(paths.includes('item.power'));
  assert.equal(paths.some((path) => /seller|phone/i.test(path)), false);
});
