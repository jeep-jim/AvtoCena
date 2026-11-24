import test from 'node:test';
import assert from 'node:assert/strict';
import {rmSync} from 'node:fs';
import {gzipSync} from 'node:zlib';
import {hash, parseListPage, createInventoryStorage} from '../inventory-storage.mjs';
import {InventoryLedger} from '../inventory-ledger.mjs';
import {createInventoryScope, inventoryChina, SERVING_SCHEMA_SHA, PROTECTED_HEADS} from '../inventory.mjs';

const PREFIX = 'migration-staging/full-20261011/';
const BUCKET = 'avtocena-staging-8120751';
const target = 'catalog/provider-snapshots/che168/' + 'a'.repeat(64) + '/';
const args = {bucket: BUCKET, physicalPrefix: PREFIX + target, configuredPrefix: PREFIX};
const esc = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function xml({keys = [target + 'manifest.json'], truncated = false, token = null, next = null, count = keys.length, prefix = PREFIX + target} = {}) {
  return Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
    <Name>${BUCKET}</Name><Prefix>${esc(prefix)}</Prefix><KeyCount>${count}</KeyCount><MaxKeys>1000</MaxKeys>
    <IsTruncated>${truncated}</IsTruncated>${token === null ? '' : `<ContinuationToken>${esc(token)}</ContinuationToken>`}
    ${next === null ? '' : `<NextContinuationToken>${esc(next)}</NextContinuationToken>`}
    ${keys.map(key => `<Contents><Key>${esc(PREFIX + key)}</Key><Size>7</Size><ETag>"opaque"</ETag><LastModified>2026-11-24T00:00:00.000Z</LastModified></Contents>`).join('')}
    </ListBucketResult>`);
}
function ledgerFor(t) { const ledger = new InventoryLedger(); t.after(() => { ledger.close(); rmSync(ledger.directory, {recursive: true, force: true}); }); return ledger; }

test('LIST parses complete XML, opaque escaped tokens and explicit empty terminal page', () => {
  const first = parseListPage(xml({truncated: true, next: 'opaque&token'}), args);
  assert.equal(first.nextToken, 'opaque&token'); assert.equal(first.objects[0].key, target + 'manifest.json');
  const second = parseListPage(xml({keys: [], token: 'opaque&token'}), {...args, continuationToken: 'opaque&token'});
  assert.equal(second.truncated, false); assert.equal(second.keyCount, 0);
});
test('LIST rejects missing token, count disagreement, unsafe scope and malformed success body', () => {
  const invalid = [
    xml({truncated: true}), xml({count: 2}), xml({keys: [target + 'x', target + 'x']}),
    xml({keys: [target.slice(0, -1) + '-other/x']}), xml({prefix: PREFIX + 'catalog/'}),
    Buffer.from(xml().toString().replace('<KeyCount>1</KeyCount>', '')),
    Buffer.from(xml().toString().replace('</ListBucketResult>', '')),
    Buffer.from(xml().toString().replace('<IsTruncated>false</IsTruncated>', '<IsTruncated>false</IsTruncated><IsTruncated>false</IsTruncated>')),
    Buffer.from('<!DOCTYPE x [<!ENTITY e SYSTEM "file:///secret">]>' + xml()),
    xml({next: 'unexpected'}), xml({token: 'foreign'}),
    Buffer.from(xml().toString().replace('<Size>7</Size>', '<Size>-1</Size>')),
  ];
  for (const input of invalid) assert.throws(() => parseListPage(input, args), /inventory_/);
});
test('disk-spooled pagination refuses token cycles and cross-page duplicate keys', t => {
  const ledger = ledgerFor(t); ledger.beginScan(target);
  ledger.page(target, null, parseListPage(xml({truncated: true, next: 'two'}), args));
  assert.throws(() => ledger.page(target, 'two', parseListPage(xml({token: 'two'}), {...args, continuationToken: 'two'})), /inventory_list_duplicate_key/);
  ledger.page(target, 'two', parseListPage(xml({keys: [target + 'second'], token: 'two', truncated: true, next: 'three'}), {...args, continuationToken: 'two'}));
  assert.throws(() => ledger.page(target, 'three', parseListPage(xml({keys: [], token: 'three', truncated: true, next: 'two'}), {...args, continuationToken: 'three'})), /inventory_list_token_cycle/);
  assert.equal(ledger.scan(target).complete, 0);
});
test('scope grants exact China references and keeps protected records HEAD-only', () => {
  const scope = createInventoryScope(); scope.reference('snapshot', target.slice(0, -1));
  assert.equal(scope.canList(target), true); assert.equal(scope.canList(target.slice(0, -1)), false);
  assert.equal(scope.canRead(target + 'manifest.json'), true);
  for (const [kind, root] of [['intake', 'catalog/nonjp-intake/v1/korea/12/1'], ['stage', 'catalog/private-market-stage-v1/china/../../settings'], ['generation', 'catalog']]) {
    assert.throws(() => scope.reference(kind, root), /inventory_reference_scope/);
  }
  assert.equal(scope.canRead('markets/markets.json'), false);
  assert.equal(scope.canRead('markets/markets.json', 'HEAD'), true);
  assert.equal(scope.canRead('integrations/ajes/config.json', 'HEAD'), false);
});
const env = {YC_OBJECT_STORAGE_ENDPOINT: 'https://s3.regru.cloud', YC_OBJECT_STORAGE_REGION: 'us-east-1',
  YC_OBJECT_STORAGE_BUCKET: BUCKET, YC_OBJECT_STORAGE_PREFIX: PREFIX,
  YC_OBJECT_STORAGE_ACCESS_KEY_ID: 'fixture-key', YC_OBJECT_STORAGE_SECRET_ACCESS_KEY: 'fixture-secret'};
test('transport exposes no mutation, blocks unauthorized requests before signing and requires conditional GET', async () => {
  const scope = createInventoryScope(); let calls = 0;
  const storage = createInventoryStorage({env, scope, request: async (url, headers, options) => {
    calls++; assert.equal(options.method, 'HEAD'); assert.equal(url.origin, 'https://s3.regru.cloud');
    return {status: 200, headers: {etag: '"v1"', 'content-length': '0'}, body: Buffer.alloc(0)};
  }});
  await storage.head('markets/markets.json'); assert.equal(calls, 1);
  await assert.rejects(storage.get('catalog/manifest.json'), /inventory_conditional_read_required/);
  await assert.rejects(storage.get('markets/markets.json', {ifMatch: '"v1"'}), /inventory_source_forbidden/);
  await assert.rejects(storage.head('integrations/ajes/config.json'), /inventory_source_forbidden/);
  assert.equal(calls, 1);
  for (const name of ['put', 'delete', 'writeJson', 'putBinary', 'deletePrefix', 'createBinaryDownloadUrl']) assert.equal(storage[name], undefined);
});
test('transport rejects redirects and GET identity drift without retrying unconditionally', async () => {
  for (const response of [{status: 302, headers: {}, body: Buffer.alloc(0)},
    {status: 200, headers: {etag: '"changed"', 'content-length': '2'}, body: Buffer.from('{}')}]) {
    let calls = 0;
    const storage = createInventoryStorage({env, scope: createInventoryScope(), request: async (_url, headers) => {
      calls++; assert.equal(headers['if-match'], '"v1"'); return response;
    }});
    await assert.rejects(storage.get('catalog/manifest.json', {ifMatch: '"v1"'}), /inventory_/);
    assert.equal(calls, 1);
  }
});

const generation = 'gen_1790000000000_fixture';
function fixture(extra = {}) {
  const values = new Map(Object.entries({'catalog/manifest.json': {version: 2, generationId: generation, markets: {china: {count: 0, chunks: []}}}, ...extra}));
  const calls = [], counts = new Map();
  const binary = key => Buffer.isBuffer(values.get(key)) ? values.get(key) : Buffer.from(JSON.stringify(values.get(key)));
  const metadata = key => values.has(key) ? {found: true, size: binary(key).length, etag: '"' + hash(binary(key)) + '"',
    versionId: null, contentType: 'application/json', contentEncoding: null} : {found: false};
  const storage = {
    scopeFingerprint: hash('fixture'),
    async head(key) { calls.push(['HEAD', key]); counts.set(key, (counts.get(key) ?? 0) + 1); return metadata(key); },
    async get(key, options) { calls.push(['GET', key]); const m = metadata(key); assert.equal(options.ifMatch, m.etag); return {...m, data: binary(key), sha256: hash(binary(key))}; },
    async listPage(prefix, token) { calls.push(['LIST', prefix]); assert.equal(token, null);
      const objects = [...values.keys()].filter(key => key.startsWith(prefix)).map(key => ({key, ...metadata(key)}));
      return {objects, truncated: false, nextToken: null, responseSha256: hash(JSON.stringify(objects)), keyCount: objects.length}; },
  };
  return {storage, values, calls, counts};
}
const serving = {releaseSha: SERVING_SCHEMA_SHA, calculationVersion: 'b'.repeat(64)};
test('initial inventory reports source shapes without leaking supplier URLs, copying payloads or sweeping shared generations', async t => {
  const binding = 'a'.repeat(64), root = 'catalog/provider-snapshots/che168/' + binding;
  const f = fixture({
    'catalog/raw-feed-config/v1/che168-snapshot.json': {version: 1, binding, config: {providerUrl: 'https://private.invalid/?password=DO_NOT_PRINT'}},
    [root + '/manifest.json']: {version: 1, binding, complete: true, config: {providerUrl: 'DO_NOT_PRINT'}, parts: [{index: 0, bytes: 4, sha256: hash('rows')}]},
    [root + '/00000.csv.gz']: gzipSync('rows'), [root + '/00000.json']: {index: 0, bytes: 4, sha256: hash('rows')},
  });
  const report = await inventoryChina({storage: f.storage, scope: createInventoryScope(), ledger: ledgerFor(t), serving});
  assert.equal(report.inventoryReadCompleted, true); assert.equal(report.contentBackupComplete, false); assert.equal(report.deletionAllowed, false);
  assert.equal(report.rootVectorStable, true);
  assert.equal(JSON.stringify(report).includes('DO_NOT_PRINT'), false); assert.equal(JSON.stringify(report).includes('private.invalid'), false);
  assert.equal(f.calls.some(([method, key]) => method === 'GET' && key.endsWith('.csv.gz')), false);
  assert.equal(f.calls.some(([method, key]) => method === 'LIST' && key.startsWith('catalog/generations/')), false);
  assert.equal(f.calls.some(([method, key]) => method === 'GET' && PROTECTED_HEADS.includes(key)), false);
  assert(report.unresolved.some(row => row.code === 'legacy_generation_inventory_deferred'));
});
test('stable HEAD/GET verification rejects a root that changes after capture', async t => {
  const f = fixture(), original = f.storage.head;
  f.storage.head = async key => { const meta = await original(key); if (key === 'catalog/manifest.json' && f.counts.get(key) >= 3) return {...meta, etag: '"changed"'}; return meta; };
  await assert.rejects(inventoryChina({storage: f.storage, scope: createInventoryScope(), ledger: ledgerFor(t), serving}), /inventory_root_vector_changed/);
});
test('missing referenced snapshot part stays an explicit failure; an empty LIST does not turn into a complete copy', async t => {
  const binding = 'a'.repeat(64), root = 'catalog/provider-snapshots/che168/' + binding;
  const f = fixture({'catalog/raw-feed-config/v1/che168-snapshot.json': {version: 1, binding},
    [root + '/manifest.json']: {version: 1, binding, complete: true, parts: [{index: 0, bytes: 4, sha256: hash('rows')}]}});
  await assert.rejects(inventoryChina({storage: f.storage, scope: createInventoryScope(), ledger: ledgerFor(t), serving}), /inventory_referenced_part_missing/);
});
test('arbitrary reference to protected or foreign storage is refused before GET', async t => {
  const f = fixture({'catalog/owned-feed/v1/china/prepared.json': {version: 1, market: 'china', runId: '123', cursor: 1,
    archiveRoot: 'integrations/ajes/config.json', archiveSha256: 'a'.repeat(64), rateRun: '123'}});
  await assert.rejects(inventoryChina({storage: f.storage, scope: createInventoryScope(), ledger: ledgerFor(t), serving}), /inventory_reference_scope/);
  assert.equal(f.calls.some(([, key]) => key === 'integrations/ajes/config.json'), false);
});
