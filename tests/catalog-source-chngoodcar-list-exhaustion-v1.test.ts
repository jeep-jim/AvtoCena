import assert from 'node:assert/strict';
import test from 'node:test';
import { stratifiedGoodCarPages } from '../scripts/catalog-source-chngoodcar-list-exhaustion-v1';

test('Good Car stratified list sampling always includes first and last page', () => {
  assert.deepEqual(stratifiedGoodCarPages(96, 6), [1, 20, 39, 58, 77, 96]);
  assert.deepEqual(stratifiedGoodCarPages(5, 6), [1, 2, 3, 4, 5]);
  assert.deepEqual(stratifiedGoodCarPages(1, 6), [1]);
});

test('Good Car stratified list sampling remains monotonic and unique', () => {
  for (const total of [2, 3, 7, 31, 96, 110]) {
    const pages = stratifiedGoodCarPages(total, 6);
    assert.equal(pages[0], 1);
    assert.equal(pages.at(-1), total);
    assert.equal(new Set(pages).size, pages.length);
    assert.deepEqual([...pages].sort((a, b) => a - b), pages);
    assert.ok(pages.every((page) => page >= 1 && page <= total));
  }
});
