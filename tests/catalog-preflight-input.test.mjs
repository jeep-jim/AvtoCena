import test from 'node:test';
import assert from 'node:assert/strict';
import {catalogPreflightInputBytes} from '../scripts/lib/catalog-preflight-input.mjs';
import {catalogStorageBudget} from '../scripts/lib/catalog-storage-budget.mjs';

test('derived budget index reserves eight copies of active projections without an intake directory', async () => {
  const storage = {
    readJson: async () => ({generationId: 'gen_active'}),
    listObjects: async prefix => [{key: `${prefix}korea.json`, size: 100_000_000}, {key: `${prefix}china.json`, size: 150_000_000}, {key: `${prefix.slice(0, -1)}-brand/toyota.json`, size: 999_000_000}],
  };
  const bytes = await catalogPreflightInputBytes(storage, {CATALOG_STORAGE_PREFLIGHT_MODE: 'budget-index'});
  assert.equal(bytes, 250_000_000);
  assert.equal(catalogStorageBudget(33_613_376_506, bytes).estimatedAdditionalBytes, 2_000_000_000);
  assert.equal(catalogStorageBudget(54_000_000_000, bytes).ok, false);
  await assert.rejects(catalogPreflightInputBytes({...storage, listObjects: async () => []}, {CATALOG_STORAGE_PREFLIGHT_MODE: 'budget-index'}));
  await assert.rejects(catalogPreflightInputBytes({...storage, listObjects: async () => [{key: 'other', size: 1}]}, {CATALOG_STORAGE_PREFLIGHT_MODE: 'budget-index'}));
  await assert.rejects(catalogPreflightInputBytes(storage, {CATALOG_REBUILD_INPUT_DIR: '/missing-intake-must-still-fail'}), {code: 'ENOENT'});
});
