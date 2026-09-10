import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { hashRows } from '../scripts/lib/catalog-row-hash.mjs';

test('streamed catalog hash preserves the canonical JSON digest and detects changes', () => {
  const rows = [{ id: 'b', z: ['Корея', null, undefined, '🚗'], a: { z: 2, a: 1 } }, { id: 'a', omitted: undefined }];
  const canonical = '[{"id":"a"},{"a":{"a":1,"z":2},"id":"b","z":["Корея",null,null,"🚗"]}]';
  assert.equal(hashRows(rows), crypto.createHash('sha256').update(canonical).digest('hex'));
  assert.equal(hashRows([...rows].reverse()), hashRows(rows));
  assert.equal(hashRows([]), crypto.createHash('sha256').update('[]').digest('hex'));
  assert.notEqual(hashRows([{ ...rows[0], id: 'changed' }, rows[1]]), hashRows(rows));
  assert.equal(rows[0].id, 'b');
});
