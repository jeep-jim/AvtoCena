import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalModelCounters } from '../apps/web/lib/catalog/canonical-model-counters';

test('live canonical model counts merge aliases and exclude unknown source titles', () => {
  const models = [{ id: 'toyota/lc250', make: 'Toyota', model: 'Land Cruiser 250', aliases: ['Prado 250'] }] as any;
  const result = canonicalModelCounters(models, [
    { model: 'Land Cruiser 250', count: 3, marketCounts: { china: 3 } },
    { model: 'Prado 250', count: 2, marketCounts: { china: 1, korea: 1 } },
    { model: 'Unknown dealer title', count: 90, marketCounts: { china: 90 } },
  ]);
  assert.equal(result.size, 1);
  assert.deepEqual(result.get('toyota/lc250'), { count: 5, marketCounts: { china: 4, korea: 1 } });
});

test('ambiguous aliases and zero-inventory models do not create live directory entries', () => {
  const models = [
    { id: 'first', model: 'First', aliases: ['Shared'] },
    { id: 'second', model: 'Second', aliases: ['Shared'] },
  ] as any;
  const result = canonicalModelCounters(models, [
    { model: 'Shared', count: 10, marketCounts: { europe: 10 } },
    { model: 'First', count: 0, marketCounts: {} },
    { model: 'Second', count: 4, marketCounts: { europe: 4 } },
  ]);
  assert.deepEqual([...result.keys()], ['second']);
});
