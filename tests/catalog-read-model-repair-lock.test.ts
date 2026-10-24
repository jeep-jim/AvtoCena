import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
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
    const workflow = readFileSync(new URL('../.github/workflows/catalog-current-read-models.yml', import.meta.url), 'utf8');
    const timeoutMinutes = Number(workflow.match(/timeout-minutes:\s*(\d+)/)?.[1]);
    assert.ok(timeoutMinutes > 0);
    assert.ok(Date.parse(String(state.value.lockedUntil)) > timeoutMinutes * 60_000,
      'publication lock must outlive the entire repair job');
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
