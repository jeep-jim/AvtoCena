import assert from 'node:assert/strict';
import test from 'node:test';
import { chinaSpecConflicts } from '../scripts/lib/china-spec-conflicts.mjs';

test('China spec conflicts cross model and series boundaries, without arbitrary winner', () => {
  const a = { sourceId: 'autohome-china', specId: 123, seriesId: 1, energy: '汽油', enginePowerKw: 100 };
  const b = { ...a, seriesId: 2, energy: '天然气', enginePowerKw: 90 };
  const result = chinaSpecConflicts([a, b]);
  assert.deepEqual(result, chinaSpecConflicts([b, a]));
  assert.deepEqual(Object.keys(result[0].conflicts), ['seriesId', 'energy', 'enginePowerKw']);
  assert.equal(result[0].specId, '123');
  assert.deepEqual(chinaSpecConflicts([a, { ...a }]), []);
  assert.deepEqual(chinaSpecConflicts([a, { ...b, specId: 124 }]), []);
  assert.deepEqual(chinaSpecConflicts([{ ...a, sourceId: 'other' }, { ...b, sourceId: 'other' }]), []);
});
