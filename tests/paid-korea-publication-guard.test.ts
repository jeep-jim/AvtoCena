import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {assertPaidKoreaPublicationSource} from '../scripts/lib/paid-korea-publication-guard.mjs';
import {transientOperationFailure} from '../scripts/lib/transient-operation.mjs';
import {persistCatalogOffers, resetCatalogReadCachesForTests} from '../apps/web/lib/catalog/storage.ts';
import {getJsonStorage, resetJsonStorageForTests} from '../apps/web/lib/data.ts';
import {defaultCollectionControls} from '../apps/web/lib/catalog/collection-controls-schema.ts';
import {COLLECTION_CONTROLS_KEY, readCollectionControls, saveCollectionSwitch,
  clearCollectionControlsCache} from '../apps/web/lib/catalog/collection-controls.ts';

const paidManifest = () => ({version: 2, generationId: 'gen_paid',
  markets: {korea: {provider: 'auto_api_encar', count: 3, chunks: []}}});
const controls = (enabled = true) => ({markets: {korea: {enabled: true}},
  sources: {encar_feed: {enabled}}});

test('ordinary Korea cannot replace a published paid source, including during a market pause', async () => {
  for (const enabled of [true, false]) {
    const current = controls(); current.markets.korea.enabled = enabled;
    await assert.rejects(assertPaidKoreaPublicationSource({market: 'korea', paidEncarInput: false,
      readManifest: async () => paidManifest(), readControls: async () => current}),
    /catalog_paid_korea_source_guard_protected/);
  }
});

test('only the validated paid-input flag bypasses paid-source ownership protection', async () => {
  const noRead = async () => {throw Error('unexpected_extra_read');};
  await assertPaidKoreaPublicationSource({market: 'korea', paidEncarInput: true,
    readManifest: noRead, readControls: noRead});
  await assert.rejects(assertPaidKoreaPublicationSource({market: 'korea', paidEncarInput: 'true',
    readManifest: async () => paidManifest(), readControls: async () => controls()}),
  /catalog_paid_korea_source_guard_protected/);
});

test('other markets retain their publication path without Korea state reads', async () => {
  const noRead = async () => {throw Error('unexpected_korea_read');};
  for (const market of ['china', 'japan', 'europe', 'uae', 'georgia']) {
    await assertPaidKoreaPublicationSource({market, paidEncarInput: false,
      readManifest: noRead, readControls: noRead});
  }
});

test('legacy Korea and an explicitly disabled paid source retain their existing behavior', async () => {
  const legacy = {...paidManifest(), markets: {korea: {count: 3, chunks: []}}};
  await assertPaidKoreaPublicationSource({market: 'korea', paidEncarInput: false,
    readManifest: async () => legacy, readControls: async () => controls()});
  await assertPaidKoreaPublicationSource({market: 'korea', paidEncarInput: false,
    readManifest: async () => paidManifest(), readControls: async () => controls(false)});
});

test('every checkpoint rereads ownership and rejects a newly selected paid source', async () => {
  let current = controls(false), reads = 0;
  const checkpoint = () => assertPaidKoreaPublicationSource({market: 'korea', paidEncarInput: false,
    readManifest: async () => {reads++; return paidManifest();}, readControls: async () => current});
  await checkpoint(); current = controls(true);
  await assert.rejects(checkpoint(), /catalog_paid_korea_source_guard_protected/);
  assert.equal(reads, 2);
});

test('manifest and CRM read failures propagate instead of authorizing publication', async () => {
  for (const failedRead of ['manifest', 'controls']) {
    const error = Error('fixture_read_unavailable');
    await assert.rejects(assertPaidKoreaPublicationSource({market: 'korea', paidEncarInput: false,
      readManifest: async () => {if (failedRead === 'manifest') throw error; return paidManifest();},
      readControls: async () => {if (failedRead === 'controls') throw error; return controls();}}),
    failure => failure === error);
  }
});

test('source ownership rejection remains nonretryable even when intake reports contain a timeout', async () => {
  const failure = await assertPaidKoreaPublicationSource({market: 'korea', paidEncarInput: false,
    readManifest: async () => paidManifest(), readControls: async () => controls()})
    .then(() => assert.fail('expected source protection'), error => error);
  assert.equal(transientOperationFailure(`${failure.message}\n{"generationStopReasons":["source_timeout"]}`), false);
});

test('real persistence preserves the active manifest both before staging and after a CRM change during staging', async () => {
  const cwd = process.cwd(), driver = process.env.JSON_STORAGE_DRIVER;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'paid-korea-source-guard-'));
  try {
    process.chdir(root); await fs.mkdir('data'); process.env.JSON_STORAGE_DRIVER = 'local';
    for (const changeDuringStaging of [false, true]) {
      resetJsonStorageForTests(); resetCatalogReadCachesForTests(); clearCollectionControlsCache();
      const storage = getJsonStorage(), baseline = paidManifest();
      const initial = defaultCollectionControls();
      initial.sources.encar_feed.enabled = !changeDuringStaging;
      await storage.writeJson('catalog/manifest.json', baseline);
      await storage.writeJson(COLLECTION_CONTROLS_KEY, initial);
      const write = storage.writeJson.bind(storage); let manifestWrites = 0, generationWrites = 0;
      let ownerChanged = false, checks = 0;
      storage.writeJson = async (key, value, condition) => {
        if (key === 'catalog/manifest.json') manifestWrites++;
        if (key.startsWith('catalog/generations/')) {
          generationWrites++;
          if (changeDuringStaging && !ownerChanged) {
            ownerChanged = true;
            const current = await readCollectionControls(storage);
            await saveCollectionSwitch({scope: 'source', id: 'encar_feed', enabled: true,
              revision: current.revision}, 'fixture owner', storage);
          }
        }
        return write(key, value, condition);
      };
      const checkpoint = async () => {
        checks++;
        await assertPaidKoreaPublicationSource({market: 'korea', paidEncarInput: false,
          readManifest: () => storage.readJson('catalog/manifest.json', null),
          readControls: () => readCollectionControls(storage)});
      };
      try {
        await assert.rejects(persistCatalogOffers([], {expectedBaseGenerationId: baseline.generationId,
          beforeManifestCommit: checkpoint}), /catalog_paid_korea_source_guard_protected/);
        assert.deepEqual(await storage.readJson('catalog/manifest.json', null), baseline);
        assert.equal(manifestWrites, 0);
        if (changeDuringStaging) {
          assert.ok(ownerChanged && generationWrites > 0 && checks > 1);
          assert.equal((await readCollectionControls(storage)).sources.encar_feed.enabled, true);
        } else {
          assert.equal(generationWrites, 0); assert.equal(checks, 1);
        }
      } finally {storage.writeJson = write;}
    }
  } finally {
    process.chdir(cwd);
    if (driver === undefined) delete process.env.JSON_STORAGE_DRIVER; else process.env.JSON_STORAGE_DRIVER = driver;
    resetJsonStorageForTests(); resetCatalogReadCachesForTests(); clearCollectionControlsCache();
    await fs.rm(root, {recursive: true, force: true});
  }
});
