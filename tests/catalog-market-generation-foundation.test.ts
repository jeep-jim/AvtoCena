import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {LocalJsonStorage, resetJsonStorageForTests} from '../apps/web/lib/data';
import {readMarketOffers, resetCatalogReadCachesForTests} from '../apps/web/lib/catalog/storage';
import {catalogReferenceDigest as digest, resolveCatalogMarketGeneration, assertCatalogMarketGenerationReceipt,
  type CatalogMarketGenerationReceipt, type CatalogMarketGenerationReference} from '../apps/web/lib/catalog/market-generation';
import {readPreparedBudgetPrices, resetSharedBudgetPriceCache, restoreBudgetPrices} from '../apps/web/lib/catalog/shared-budget-prices';
import {readReferencedCatalogGenerationClosure, referencedCatalogGenerations} from '../scripts/lib/catalog-generation-references.mjs';

const ROOT_KEYS = ['catalog/manifest.json', 'catalog/previous-manifest.json', 'catalog/internal/manifest.json'];
const NEW = 'gen_1600000004000_korea', OLD = 'gen_1600000002000_europe';
const PREVIOUS = 'gen_1600000003000_rollback', RETAINED = 'gen_1600000001000_retained', ORPHAN = 'gen_1500000000000_orphan';
const now = Date.now(), currentDate = new Date(now).toISOString(), oldDate = new Date(now - 2 * 86400000).toISOString();
const maintenance = fileURLToPath(new URL('../scripts/catalog-storage-maintenance.mjs', import.meta.url));
const loader = fileURLToPath(new URL('../node_modules/tsx/dist/loader.mjs', import.meta.url));
const offline = fileURLToPath(new URL('./helpers/offline-fetch.mjs', import.meta.url));

function reference(receipt: CatalogMarketGenerationReceipt): CatalogMarketGenerationReference {
  const sha256 = digest(receipt);
  return {version: 1, market: receipt.market, generationId: receipt.generationId,
    receipt: {key: `catalog/generations/${receipt.generationId}/market-receipts-v1/${receipt.market}/${sha256}.json`, sha256}};
}

function fixture() {
  const objects = new Map<string, any>();
  function receipt(market: 'korea' | 'europe', generationId: string, rows: any[][], updatedAt: string,
    extra: {references?: {key: string; sha256: string}[]; retainedReceipts?: CatalogMarketGenerationReference[]; absolute?: boolean} = {}) {
    const chunkNames = rows.map((_, i) => `chunk-${String(i + 1).padStart(4, '0')}`);
    const chunkKeys = chunkNames.map(chunk => `catalog/generations/${generationId}/offers/${market}/${chunk}.json`);
    rows.forEach((value, i) => objects.set(chunkKeys[i], value));
    const value: CatalogMarketGenerationReceipt = {version: 1, kind: 'accepted_market_generation_v1', market, generationId,
      entry: {count: rows.reduce((sum, value) => sum + value.length, 0), chunks: extra.absolute ? chunkKeys : chunkNames, updatedAt},
      references: [...chunkKeys.map(key => ({key, sha256: digest(objects.get(key))})), ...(extra.references || [])],
      retainedReceipts: extra.retainedReceipts || []};
    const ref = reference(value); objects.set(ref.receipt.key, value);
    return {value, ref, chunkKeys, entry: {...value.entry, acceptedGeneration: ref}};
  }
  const fingerprint = 'original-europe-calculation-context';
  const source: any[] = [['europe', 1500000, null, null, false, {id: 'e-old', make: 'Volkswagen', block: 0}]];
  const sourceIds = digest(source.map(row => row[5].id));
  const priceKey = digest([OLD, 'europe', fingerprint, sourceIds]);
  const prices = [['e-old', 1500000, null, false, null]];
  const price = {version: 1, key: priceKey, sourceIds, createdAt: now - 3600000, prices, checksum: digest(prices)};
  const pricePath = `catalog/runtime-budget-prices-v3/europe/${priceKey}.json`;
  objects.set(pricePath, price);
  const landingKey = `catalog/generations/${RETAINED}/indexes/landing/europe-${oldDate.slice(0, 10)}.json`;
  const landing = {generationId: RETAINED, policyDate: oldDate.slice(0, 10), createdAt: oldDate, items: [{id: 'e-old'}]};
  objects.set(landingKey, landing);
  const retained = receipt('europe', RETAINED, [], oldDate, {references: [{key: landingKey, sha256: digest(landing)}]});
  const europe = receipt('europe', OLD, [[{id: 'e-old', market: 'europe', updatedAt: oldDate}]], oldDate,
    {absolute: true, references: [{key: pricePath, sha256: digest(price)}], retainedReceipts: [retained.ref]});
  const korea = receipt('korea', NEW, [[{id: 'k-new-1', market: 'korea', updatedAt: currentDate}],
    [{id: 'k-new-2', market: 'korea', updatedAt: currentDate}]], currentDate);
  const previous = receipt('korea', PREVIOUS, [], oldDate, {retainedReceipts: [retained.ref]});
  objects.set(ROOT_KEYS[0], {version: 2, generationId: NEW, updatedAt: currentDate, markets: {korea: korea.entry, europe: europe.entry}});
  objects.set(ROOT_KEYS[1], {version: 2, generationId: PREVIOUS, updatedAt: oldDate, markets: {korea: previous.entry}});
  objects.set(ROOT_KEYS[2], {generationId: NEW, sources: {}});
  for (const generation of [NEW, OLD, PREVIOUS, RETAINED, ORPHAN])
    objects.set(`catalog/generations/${generation}/indexes/images-by-id.json`, {imagesById: {}});
  return {objects, korea, europe, retained, previous, price, pricePath, source, fingerprint, landingKey, landing};
}

async function withDisk(fn: (context: {root: string; storage: LocalJsonStorage; data: ReturnType<typeof fixture>;
  put: (key: string, value: any) => Promise<void>; roots: () => Promise<{key: string; value: any}[]>}) => Promise<void>) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'catalog-market-generation-'));
  const cwd = process.cwd(), names = ['JSON_STORAGE_DRIVER', 'NODE_ENV'];
  const env = Object.fromEntries(names.map(name => [name, process.env[name]]));
  const storage = new LocalJsonStorage(), data = fixture();
  await fs.mkdir(path.join(root, 'data'));
  try {
    process.chdir(root); process.env.JSON_STORAGE_DRIVER = 'local'; process.env.NODE_ENV = 'test';
    resetJsonStorageForTests(); resetCatalogReadCachesForTests(); resetSharedBudgetPriceCache();
    const put = async (key: string, value: any) => {await storage.writeJson(key, value); resetCatalogReadCachesForTests();};
    for (const [key, value] of data.objects) await put(key, value);
    await fn({root, storage, data, put, roots: () => Promise.all(ROOT_KEYS.map(async key => ({key, value: await storage.readJson(key, null)})))});
  } finally {
    resetCatalogReadCachesForTests(); resetSharedBudgetPriceCache(); resetJsonStorageForTests();
    process.chdir(cwd);
    for (const name of names) if (env[name] === undefined) delete process.env[name]; else process.env[name] = env[name];
    await fs.rm(root, {recursive: true, force: true});
  }
}

test('real legacy market reads retain relative and absolute paths without reading receipts', async () => {
  await withDisk(async ({data, put, storage}) => {
    const manifest = structuredClone(data.objects.get(ROOT_KEYS[0]));
    delete manifest.markets.korea.acceptedGeneration; delete manifest.markets.europe.acceptedGeneration;
    await put(ROOT_KEYS[0], manifest);
    for (const item of [data.korea, data.europe, data.previous, data.retained]) await storage.deleteJson(item.ref.receipt.key);
    const read = await resolveCatalogMarketGeneration(manifest, 'europe', async () => {throw Error('legacy receipt IO');});
    assert.equal(read?.kind, 'legacy'); assert.equal(read?.generationId, NEW);
    assert.deepEqual(read?.chunkKeys, data.europe.chunkKeys);
    assert.deepEqual((await readMarketOffers('korea')).map(row => row.id), ['k-new-1', 'k-new-2']);
    assert.deepEqual((await readMarketOffers('europe')).map(row => row.id), ['e-old']);
    assert.deepEqual(await readMarketOffers('georgia'), []);
  });
});

test('real mixed-generation reads keep old Europe identity, dates and original price context', async () => {
  await withDisk(async ({data, storage}) => {
    const manifest = await storage.readJson<any>(ROOT_KEYS[0], null);
    const before = digest(manifest);
    const resolve = (market: string) => resolveCatalogMarketGeneration(manifest, market, storage.readJson.bind(storage));
    const korea = await resolve('korea'), europe = await resolve('europe');
    assert.equal(korea?.generationId, NEW); assert.equal(europe?.generationId, OLD);
    assert.deepEqual(europe?.chunkKeys, data.europe.chunkKeys); assert.equal(europe?.entry.updatedAt, oldDate);
    assert.deepEqual((await readMarketOffers('korea')).map(row => row.id), ['k-new-1', 'k-new-2']);
    assert.deepEqual(await readMarketOffers('europe'), data.objects.get(data.europe.chunkKeys[0]));
    const index: any = {generationId: europe!.generationId, rows: data.source, otherRows: []};
    assert.equal((await readPreparedBudgetPrices(index, 'europe', data.fingerprint))?.[0][1], 1500000);
    assert.equal(await readPreparedBudgetPrices({...index, generationId: NEW}, 'europe', data.fingerprint), null);
    assert.equal(await readPreparedBudgetPrices(index, 'europe', 'new-context'), null);
    assert.equal(restoreBudgetPrices(data.price, data.price.key, data.source, data.price.createdAt + 86400001), null,
      'preserving an immutable reference never extends price validity');
    assert.deepEqual(await storage.readJson(data.pricePath, null), data.price);
    assert.deepEqual(await storage.readJson(data.landingKey, null), data.landing);
    assert.equal(digest(await storage.readJson(ROOT_KEYS[0], null)), before, 'reads never rewrite generation/date/reference');
  });
});

test('present accepted references fail closed for missing receipts, drifted entries and damaged chunks', async () => {
  await withDisk(async ({data, storage, put}) => {
    const original = data.objects.get(ROOT_KEYS[0]);
    const invalid = structuredClone(original); invalid.markets.korea.acceptedGeneration = null;
    await put(ROOT_KEYS[0], invalid); await assert.rejects(readMarketOffers('korea'), /generation_reference/);
    await put(ROOT_KEYS[0], original); await storage.deleteJson(data.korea.ref.receipt.key);
    await assert.rejects(readMarketOffers('korea'), /generation_receipt/);
    await put(data.korea.ref.receipt.key, {...data.korea.value, generationId: OLD});
    await assert.rejects(readMarketOffers('korea'), /generation_receipt/);
    await put(data.korea.ref.receipt.key, data.korea.value);
    const drifted = structuredClone(original); drifted.markets.korea.count++;
    await put(ROOT_KEYS[0], drifted); await assert.rejects(readMarketOffers('korea'), /manifest_entry_changed/);
    await put(ROOT_KEYS[0], original); await storage.deleteJson(data.korea.chunkKeys[1]);
    await assert.rejects(readMarketOffers('korea'), /generation_chunk/);
    await put(data.korea.chunkKeys[1], [{id: 'changed', market: 'korea'}]);
    await assert.rejects(readMarketOffers('korea'), /generation_chunk/);
  });
});

test('valid hashes cannot hide wrong-market rows, duplicate IDs or an incorrect declared count', async () => {
  await withDisk(async ({data, storage, put}) => {
    const originalRows = data.objects.get(data.korea.chunkKeys[1]);
    for (const [rows, count] of [[[{id: 'foreign', market: 'europe'}], 2], [[{id: 'k-new-1', market: 'korea'}], 2], [originalRows, 3]] as const) {
      await put(data.korea.chunkKeys[1], rows);
      const receipt = structuredClone(data.korea.value) as any;
      receipt.entry.count = count; receipt.references[1].sha256 = digest(rows);
      const ref = reference(receipt); await put(ref.receipt.key, receipt);
      const manifest = structuredClone(data.objects.get(ROOT_KEYS[0]));
      manifest.markets.korea = {...receipt.entry, acceptedGeneration: ref}; await put(ROOT_KEYS[0], manifest);
      await assert.rejects(readMarketOffers('korea'), /generation_(chunk|count)/);
    }
    assert.ok(await storage.exists(data.europe.chunkKeys[0]));
  });
});

test('receipt schema rejects cross-market chunks, unsafe paths and opaque receipt leaves', () => {
  const data = fixture();
  for (const damage of [
    (value: any) => {value.entry.chunks[0] = data.europe.chunkKeys[0]; value.references.push({key: data.europe.chunkKeys[0], sha256: digest([])});},
    (value: any) => {value.references.push({key: `catalog/generations/${NEW}/../escape.json`, sha256: digest([])});},
    (value: any) => {value.references.push(data.retained.ref.receipt);},
    (value: any) => {value.entry.count = Number.MAX_SAFE_INTEGER + 1;},
    (value: any) => {value.entry.chunks.push(value.entry.chunks[0]);},
  ]) {
    const value = structuredClone(data.korea.value); damage(value);
    assert.throws(() => assertCatalogMarketGenerationReceipt(value, reference(value)), /catalog_market_generation_/);
  }
});

test('GC follows active and rollback receipts transitively, retaining immutable leaves without new dates', async () => {
  await withDisk(async ({data, storage, roots}) => {
    const reads = new Map<string, number>();
    const closure = await readReferencedCatalogGenerationClosure({roots: await roots(), readJson: async (key: string, fallback: null) => {
      reads.set(key, (reads.get(key) || 0) + 1); return storage.readJson(key, fallback);
    }});
    assert.deepEqual([...closure.generations].sort(), [NEW, OLD, PREVIOUS, RETAINED].sort());
    assert.equal(closure.receiptCount, 4); assert.equal(reads.get(data.retained.ref.receipt.key), 1, 'shared retained receipt is loaded once');
    for (const key of [data.pricePath, data.landingKey, data.retained.ref.receipt.key, ...data.europe.chunkKeys]) assert.ok(closure.objectKeys.has(key));
    await closure.assertUnchanged();
    assert.deepEqual(await storage.readJson(data.landingKey, null), data.landing);
    assert.deepEqual(await storage.readJson(data.pricePath, null), data.price);
  });
});

test('GC rejects missing transitive receipts, conflicting leaf digests and changed roots or receipts', async () => {
  await withDisk(async ({data, storage, roots, put}) => {
    const readJson = storage.readJson.bind(storage);
    await storage.deleteJson(data.retained.ref.receipt.key);
    await assert.rejects(readReferencedCatalogGenerationClosure({roots: await roots(), readJson}), /generation_receipt/);
    await put(data.retained.ref.receipt.key, data.retained.value);
    const closure = await readReferencedCatalogGenerationClosure({roots: await roots(), readJson});
    const changed = structuredClone(data.objects.get(ROOT_KEYS[0])); changed.markets.europe.updatedAt = currentDate;
    await put(ROOT_KEYS[0], changed); await assert.rejects(closure.assertUnchanged(), /closure_root_changed/);
    await put(ROOT_KEYS[0], data.objects.get(ROOT_KEYS[0]));
    await put(data.retained.ref.receipt.key, {...data.retained.value, entry: {...data.retained.value.entry, updatedAt: currentDate}});
    await assert.rejects(closure.assertUnchanged(), /closure_receipt_changed/);
    await put(data.retained.ref.receipt.key, data.retained.value);
    const previous = structuredClone(data.previous.value) as any;
    previous.references.push({key: data.landingKey, sha256: digest('conflicting leaf')});
    const ref = reference(previous); await put(ref.receipt.key, previous);
    const previousRoot = structuredClone(data.objects.get(ROOT_KEYS[1])); previousRoot.markets.korea.acceptedGeneration = ref;
    await put(ROOT_KEYS[1], previousRoot);
    await assert.rejects(readReferencedCatalogGenerationClosure({roots: await roots(), readJson}), /closure_conflicting_object/);
  });
});

test('GC final check detects a root changed while immutable receipts are being rechecked', async () => {
  await withDisk(async ({data, storage, roots, put}) => {
    let checking = false, changed = false;
    const closure = await readReferencedCatalogGenerationClosure({roots: await roots(), readJson: async (key: string, fallback: null) => {
      if (checking && !changed && key === data.retained.ref.receipt.key) {
        changed = true;
        const root = structuredClone(data.objects.get(ROOT_KEYS[0])); root.updatedAt = oldDate;
        await put(ROOT_KEYS[0], root);
      }
      return storage.readJson(key, fallback);
    }});
    checking = true; await assert.rejects(closure.assertUnchanged(), /closure_root_changed/);
    assert.equal(changed, true);
  });
});

test('legacy GC closure keeps the existing generation set and performs no receipt reads', async () => {
  const roots = [{key: ROOT_KEYS[0], value: {generationId: NEW, markets: {europe: {chunks: [`catalog/generations/${OLD}/offers/europe/chunk-1.json`]}}}},
    {key: ROOT_KEYS[1], value: {generationId: PREVIOUS}}, {key: ROOT_KEYS[2], value: null}];
  const closure = await readReferencedCatalogGenerationClosure({roots, readJson: async () => {throw Error('unexpected legacy receipt IO');}});
  assert.deepEqual(closure.generations, referencedCatalogGenerations(...roots.map(root => root.value)));
  assert.equal(closure.receiptCount, 0); assert.equal(closure.objectKeys.size, 0);
  await assert.rejects(readReferencedCatalogGenerationClosure({roots: roots.slice(0, 2), readJson: async () => null}), /closure_roots/);
});

test('actual maintenance protects transitive generations and stale referenced price objects while deleting orphans', async () => {
  await withDisk(async ({root, data, storage, put}) => {
    const orphanPrice = `catalog/runtime-budget-prices-v3/europe/${'f'.repeat(64)}.json`;
    await put(orphanPrice, {orphan: true});
    const stale = new Date(now - 10 * 86400000);
    for (const key of [data.pricePath, orphanPrice]) await fs.utimes(path.join(root, 'data', key), stale, stale);
    const result = spawnSync(process.execPath, ['--import', loader, '--import', offline, maintenance],
      {cwd: root, env: {...process.env, JSON_STORAGE_DRIVER: 'local', CATALOG_STORAGE_LOCK_WAIT_MS: '0'}, encoding: 'utf8'});
    assert.equal(result.status, 0, result.stderr);
    assert.equal(await storage.exists(`catalog/generations/${ORPHAN}/indexes/images-by-id.json`), false);
    assert.equal(await storage.exists(orphanPrice), false);
    for (const key of [data.pricePath, data.landingKey, data.retained.ref.receipt.key, ...data.europe.chunkKeys]) assert.equal(await storage.exists(key), true);
    const report = JSON.parse(await fs.readFile(path.join(root, 'catalog-storage-cleanup-report.json'), 'utf8'));
    assert.equal(report.protectedMarketReceipts, 4); assert.ok(report.protectedGenerations.includes(RETAINED));
    assert.equal((await storage.readJson<any>('catalog/import-lock.json', null)).lockedUntil, '');
    assert.deepEqual(await storage.readJson(data.pricePath, null), data.price);
  });
});

test('actual maintenance fails before deletion for an unreadable retained receipt and releases its own lease', async () => {
  await withDisk(async ({root, data, storage}) => {
    await storage.deleteJson(data.retained.ref.receipt.key);
    const result = spawnSync(process.execPath, ['--import', loader, '--import', offline, maintenance],
      {cwd: root, env: {...process.env, JSON_STORAGE_DRIVER: 'local', CATALOG_STORAGE_LOCK_WAIT_MS: '0'}, encoding: 'utf8'});
    assert.notEqual(result.status, 0); assert.match(result.stderr, /catalog_market_generation_receipt/);
    assert.equal(await storage.exists(`catalog/generations/${ORPHAN}/indexes/images-by-id.json`), true);
    assert.equal((await storage.readJson<any>('catalog/import-lock.json', null)).lockedUntil, '');
  });
});
