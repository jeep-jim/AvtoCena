import assert from 'node:assert/strict';
import test from 'node:test';
import { extractWorldAutoRouteLiterals } from '../scripts/catalog-source-worldauto-declared-asset-route-probe-v1.mjs';

test('extracts only same-origin car/api/search route literals from declared JS', () => {
  const js = `
    const a='/api/cars/search?page=2&size=20';
    const b='/en/car/toyota-prius-12345';
    const c='https://worldauto.ge/api/vehicle/42?token=secret-value&id=42';
    const d='https://external.example.com/api/cars';
    const e='/assets/car.png';
    const f='/en/search/car/tbilisi';
  `;
  const result = extractWorldAutoRouteLiterals(js, 'https://worldauto.ge');
  assert.ok(result.all.includes('/api/cars/search?page&size'));
  assert.ok(result.all.includes('/en/car/toyota-prius-12345'));
  assert.ok(result.all.includes('/api/vehicle/42?id&token'));
  assert.equal(result.all.some((row) => row.includes('secret-value')), false);
  assert.equal(result.all.some((row) => row.includes('external.example.com')), false);
  assert.equal(result.all.some((row) => row.includes('car.png')), false);
  assert.ok(result.apiLike.length >= 2);
  assert.ok(result.detailLike.includes('/en/car/toyota-prius-12345'));
  assert.ok(result.searchLike.includes('/en/search/car/tbilisi'));
});

test('does not invent routes when declared JS contains no actionable literals', () => {
  const result = extractWorldAutoRouteLiterals(`const title='Cars'; const version='1.0.0';`, 'https://worldauto.ge');
  assert.deepEqual(result.all, []);
  assert.deepEqual(result.apiLike, []);
  assert.deepEqual(result.detailLike, []);
  assert.deepEqual(result.searchLike, []);
});
