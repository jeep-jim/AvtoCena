import assert from 'node:assert/strict';
import test from 'node:test';
import { priceCandidatesUntil } from '../apps/web/lib/catalog/price-candidates';

test('a four-card rail does not price all 48 candidates', async () => {
  let priced = 0;
  const result = await priceCandidatesUntil(Array.from({length: 48}, (_, id) => id), async rows => {
    priced += rows.length; return rows;
  }, () => true, rows => rows.length >= 4);
  assert.equal(priced, 4);
  assert.deepEqual(result, [0, 1, 2, 3]);
});

test('rejected prices and repeated models do not prevent later eligible candidates', async () => {
  const rows = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  let priced = 0;
  const result = await priceCandidatesUntil(rows, async batch => {
    priced += batch.length; return batch;
  }, row => row >= 2, accepted => new Set(accepted.map(row => Math.floor(row / 2))).size >= 4);
  assert.equal(priced, 12);
  assert.deepEqual(result, rows.slice(2));
});
