import test from 'node:test';
import assert from 'node:assert/strict';
import { explicitAutohomeDisplacement } from '../scripts/lib/autohome-displacement.mjs';

const fields = (...rows: any[]) => new Map(rows.map((row, i) => [i, row]));
test('Autohome exact displacement keeps source field and does not round litres', () => {
  const row = { id: 1, name: '排量(mL)', value: '1498' };
  const result = explicitAutohomeDisplacement(fields(row, { name: '发动机', value: '1.5T 150马力 L4' }));
  assert.equal(result.engineCc, 1498);
  assert.deepEqual(result.engineCcEvidence.fields, [{ parameterId: 1, name: '排量(mL)', rawValue: '1498' }]);
  assert.equal(explicitAutohomeDisplacement(fields({ name: '排量(L)', value: '1.5' })).engineCc, null);
});
test('Autohome displacement rejects alternatives, ranges, missing units and malformed values', () => {
  for (const value of ['1498 / 1499', '1498–1998', '1.5', '1498 unknown', '0', '10001', '']) {
    assert.equal(explicitAutohomeDisplacement(fields({ name: '排量(mL)', value })).engineCc, null);
  }
  assert.equal(explicitAutohomeDisplacement(fields({ name: '排量', value: '1498' })).engineCc, null);
  assert.equal(explicitAutohomeDisplacement(fields()).engineCcEvidence.status, 'missing');
});
test('Autohome duplicate displacement fields must agree', () => {
  const a = { name: '排量（mL）', value: '1498 mL' };
  assert.equal(explicitAutohomeDisplacement(fields(a, { name: '排量(cc)', value: '1498' })).engineCc, 1498);
  assert.equal(explicitAutohomeDisplacement(fields(a, { name: '排量(cc)', value: '1499' })).engineCcEvidence.status, 'ambiguous');
});
