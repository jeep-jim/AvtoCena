import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { getJsonStorage, resetJsonStorageForTests } from '../apps/web/lib/data';
import { CATALOG_CHUNK_SIZE, iterateOffersForMaintenance, persistInternalCatalog } from '../apps/web/lib/catalog/storage';

test('streaming preservation retains full raw records, fills public gaps and commits only after every chunk succeeds', async () => {
  const cwd = process.cwd();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'avtocena-internal-stream-'));
  const driver = process.env.JSON_STORAGE_DRIVER;
  fs.mkdirSync(path.join(directory, 'data'));
  process.chdir(directory);
  process.env.JSON_STORAGE_DRIVER = 'local';
  resetJsonStorageForTests();
  const row = (id: string): any => ({ id, market: 'korea', sourceId: 'encar_direct',
    operational: { sourceUrl: 'https://fem.encar.com/cars/detail/42490928', raw: { sourcePayload: { exactSpecifications: 'retain this complete table' } } } });
  try {
    const storage = getJsonStorage();
    let yielded = 0;
    async function* fullRows() {
      for (let i = 0; i < CATALOG_CHUNK_SIZE * 2 + 1; i++) {
        // The first chunk must reach storage before we supply the second chunk.
        if (i === CATALOG_CHUNK_SIZE) assert.equal((await storage.readJsonWithMeta('catalog/internal/offers/encar_direct/gen_stream-chunk-0001.json', null)).found, true);
        yielded++;
        yield [row(String(i))];
      }
    }
    const compact = row('0'); delete compact.operational.raw;
    await persistInternalCatalog(storage, 'gen_stream', [compact, row('public-only')], fullRows());
    const manifest: any = await storage.readJson('catalog/internal/manifest.json', null);
    assert.equal(manifest.sources.encar_direct.count, yielded + 1);
    assert.equal(manifest.sources.encar_direct.chunks.length, 3);
    const restored = [];
    for await (const rows of iterateOffersForMaintenance({ excludeMarket: 'uae' })) restored.push(...rows);
    assert.equal(restored.length, yielded + 1);
    assert.deepEqual(restored.find(r => r.id === '0'), row('0'));
    assert.equal(restored.filter(r => r.id === 'public-only').length, 1);
    let excluded = 0;
    for await (const rows of iterateOffersForMaintenance({ excludeMarket: 'korea' })) excluded += rows.length;
    assert.equal(excluded, 0);
    async function* broken() { yield [row('stage')]; throw new Error('read_failed'); }
    await assert.rejects(persistInternalCatalog(storage, 'gen_failed', [], broken()), /read_failed/);
    assert.deepEqual(await storage.readJson('catalog/internal/manifest.json', null), manifest);
    await storage.deleteJson!(manifest.sources.encar_direct.chunks[0]);
    await assert.rejects(async () => { for await (const rows of iterateOffersForMaintenance({ excludeMarket: 'uae' })) void rows; }, /catalog_maintenance_chunk_missing/);
  } finally {
    process.chdir(cwd);
    if (driver === undefined) delete process.env.JSON_STORAGE_DRIVER; else process.env.JSON_STORAGE_DRIVER = driver;
    resetJsonStorageForTests();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
