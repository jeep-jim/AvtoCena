import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {dirname, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import test, {after, mock} from 'node:test';

// Evidence for this source only. Documentation descendants are acceptable;
// another runtime tree or dirty runtime inputs must fail before importing code.
const SOURCE = 'f45efaf2b172af41d14987fb642e8e6b6df78cdd';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], {encoding: 'utf8'}).trim();
assert.equal(git('rev-parse', `${SOURCE}^{commit}`), SOURCE, 'audit_source_missing');
git('merge-base', '--is-ancestor', SOURCE, 'HEAD');
const runtimeInputs = ['apps/web', 'packages', 'data', 'Dockerfile', 'package.json', 'package-lock.json'];
for (const path of runtimeInputs) {
  assert.equal(git('rev-parse', `HEAD:${path}`), git('rev-parse', `${SOURCE}:${path}`), `audit_source_changed:${path}`);
}
git('diff', '--quiet', 'HEAD', '--', ...runtimeInputs);
assert.equal(git('ls-files', '--others', '--exclude-standard', '--', 'apps/web', 'packages', 'data'), '', 'audit_untracked_runtime_inputs');

// No environment credentials, source requests, or real storage are used.
process.env.NODE_ENV = 'production';
process.env.AVTOCENA_RELEASE_SHA = SOURCE;
process.env.JSON_STORAGE_DRIVER = 'object';
process.env.YC_OBJECT_STORAGE_BUCKET = 'offline-fixture';
process.env.YC_OBJECT_STORAGE_ACCESS_KEY_ID = 'offline-fixture';
process.env.YC_OBJECT_STORAGE_SECRET_ACCESS_KEY = 'offline-fixture';
process.env.YC_OBJECT_STORAGE_ENDPOINT = 'https://offline-storage.invalid';
process.env.CATALOG_LIVE_RATE_DISABLED = 'true';
let networkAttempts = 0;
globalThis.fetch = async () => { networkAttempts++; throw Error('f45_audit_network_forbidden'); };
const fromRoot = (path: string) => pathToFileURL(resolve(root, path)).href;
const data = await import(fromRoot('apps/web/lib/data.ts'));
const storage = await import(fromRoot('apps/web/lib/catalog/storage.ts'));
let readKeys: string[] = [], writes: string[] = [], values = new Map<string, unknown>();
mock.method(data.ObjectJsonStorage.prototype, 'readJsonWithMeta', async function(key: string, fallback: unknown) {
  readKeys.push(key);
  return {found: values.has(key), value: values.has(key) ? structuredClone(values.get(key)) : fallback,
    ...(values.has(key) ? {etag: 'offline'} : {})};
});
mock.method(data.ObjectJsonStorage.prototype, 'writeJson', async function(key: string, value: unknown) {
  writes.push(key); values.set(key, structuredClone(value));
});
mock.method(data.ObjectJsonStorage.prototype, 'putBinary', async function(key: string) {
  writes.push(key); throw Error('unexpected_binary');
});
after(() => { mock.restoreAll(); assert.equal(networkAttempts, 0, 'unexpected_network_attempt'); });

test('exact f45 blocks API-style persistence before any storage read/write in both seller modes', async () => {
  assert.equal(storage.CATALOG_PRODUCTION_WRITES_PAUSED, true);
  for (const enabled of ['0', '1']) {
    process.env.CATALOG_SELLER_INVENTORY = enabled; readKeys = []; writes = [];
    assert.equal(storage.isCatalogProductionRefreshAllowed({}), false);
    assert.equal(storage.isCatalogProductionRefreshAllowed({productionRefreshMarket: 'korea'}), false);
    await assert.rejects(storage.persistCatalogOffers([], {}), /catalog_production_writes_paused/);
    assert.deepEqual(readKeys, []); assert.deepEqual(writes, []);
  }
});

test('actual importer reaches the hard stop without suppliers and writes only its service lock', async () => {
  readKeys = []; writes = []; values = new Map();
  const importer = await import(fromRoot('apps/web/lib/catalog/importer.ts'));
  await assert.rejects(importer.importCatalog(['__offline_no_matching_source__']), /catalog_production_writes_paused/);
  assert.deepEqual(writes, Array(3).fill('catalog/import-lock.json'));
  console.log(JSON.stringify({source: SOURCE, directStorageReads: 0, directStorageWrites: 0,
    importerWrites: writes, importerReadKeys: [...new Set(readKeys)]}));
});

test('actual protected POST ignores publication-like request fields and cannot write manifests', async () => {
  process.env.CATALOG_ADMIN_TOKEN = 'offline-admin-only'; readKeys = []; writes = []; values = new Map();
  const route = await import(fromRoot('apps/web/app/(public)/api/catalog/import/route.ts'));
  const unauthorized = await route.POST(new Request('https://offline-app.invalid/api/catalog/import', {method: 'POST', body: '{}'}));
  assert.equal(unauthorized.status, 403); assert.deepEqual(writes, []);
  const request = new Request('https://offline-app.invalid/api/catalog/import', {
    method: 'POST', headers: {'x-admin-token': 'offline-admin-only', 'content-type': 'application/json'},
    body: JSON.stringify({sources: ['__offline_no_matching_source__'], productionRefreshMarket: 'korea',
      weeklyInventory: true, beforePersistValidate: 'untrusted_request_field', beforePublishValidate: 'untrusted_request_field',
      reportPath: 'catalog/manifest.json'}),
  });
  await assert.rejects(route.POST(request), /catalog_production_writes_paused/);
  assert.deepEqual(writes, Array(3).fill('catalog/import-lock.json'));
  console.log(JSON.stringify({source: SOURCE, actualRouteWrites: writes, requestPublicationFieldsIgnored: true}));
});
