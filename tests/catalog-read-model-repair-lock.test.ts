import assert from 'node:assert/strict';
import test from 'node:test';
import { withCatalogReadModelRepairLock } from '../scripts/lib/catalog-read-model-repair-lock.mjs';

function fixture(initial: Record<string, unknown> = {}) {
  let value = initial;
  return {
    get value() { return value; },
    mutate: async (path: string, _fallback: unknown, update: (current: any) => any) => {
      assert.equal(path, 'catalog/import-lock.json');
      value = update(value);
      return value;
    },
  };
}
test('repair holds the shared publisher lock and releases it after success', async () => {
  const state = fixture();
  const result = await withCatalogReadModelRepairLock(state.mutate, async () => {
    assert.equal(state.value.operationType, 'catalog_read_model_repair');
    assert.equal(Date.parse(String(state.value.lockedUntil)), 2_400_000);
    return 'repaired';
  }, () => 0);
  assert.equal(result, 'repaired');
  assert.equal(state.value.lockedUntil, '');
});
test('repair refuses to overwrite an active Japan publication lock', async () => {
  const initial = {operationId: 'japan', lockedUntil: new Date(60_000).toISOString()};
  const state = fixture(initial);
  await assert.rejects(withCatalogReadModelRepairLock(state.mutate, () => assert.fail('must not write'), () => 0), /publication_locked/);
  assert.deepEqual(state.value, initial);
});
test('repair releases its lock when writing fails', async () => {
  const state = fixture();
  await assert.rejects(withCatalogReadModelRepairLock(state.mutate, async () => { throw new Error('storage failed'); }), /storage failed/);
  assert.equal(state.value.lockedUntil, '');
});
test('repair never releases a lock that was replaced by another operation', async () => {
  const state = fixture();
  await withCatalogReadModelRepairLock(state.mutate, async () => {
    await state.mutate('catalog/import-lock.json', {}, () => ({operationId: 'other', lockedUntil: 'preserve'}));
  });
  assert.deepEqual(state.value, {operationId: 'other', lockedUntil: 'preserve'});
});
