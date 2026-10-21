import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { hashRows, snapshotCatalogRows, assertCatalogRowsUnchanged } from '../scripts/lib/catalog-row-hash.mjs';

test('streamed catalog hash preserves the canonical JSON digest and detects changes', () => {
  const rows = [{ id: 'b', z: ['Корея', null, undefined, '🚗'], a: { z: 2, a: 1 } }, { id: 'a', omitted: undefined }];
  const canonical = '[{"id":"a"},{"a":{"a":1,"z":2},"id":"b","z":["Корея",null,null,"🚗"]}]';
  assert.equal(hashRows(rows), crypto.createHash('sha256').update(canonical).digest('hex'));
  assert.equal(hashRows([...rows].reverse()), hashRows(rows));
  assert.equal(hashRows([]), crypto.createHash('sha256').update('[]').digest('hex'));
  assert.notEqual(hashRows([{ ...rows[0], id: 'changed' }, rows[1]]), hashRows(rows));
  assert.equal(rows[0].id, 'b');
});


test('publication baseline survives releasing rows and still rejects concurrent changes', () => {
  const rows = [{ id: 'korea-a', price: 120 }, { id: 'korea-b', price: 130 }];
  const latest = structuredClone(rows);
  const baseline = snapshotCatalogRows(rows);
  rows.length = 0;
  assert.doesNotThrow(() => assertCatalogRowsUnchanged(baseline, latest, 'korea'));
  assert.doesNotThrow(() => assertCatalogRowsUnchanged(baseline, [...latest].reverse(), 'korea'));
  assert.throws(() => assertCatalogRowsUnchanged(baseline, [], 'korea'), /catalog_target_changed/);
  assert.throws(() => assertCatalogRowsUnchanged(baseline, [latest[0], {...latest[1],price:140}], 'korea'), /catalog_target_changed/);
  assert.throws(() => assertCatalogRowsUnchanged(baseline, [...latest, {id:'new'}], 'korea'), /catalog_target_changed/);
});
