import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {materializeChinaRuntimeContext, createChinaRuntimeReader} from '../scripts/catalog-next/runtime-context.mjs';

const exec = promisify(execFile), hash = bytes => createHash('sha256').update(bytes).digest('hex');
const jsonHash = value => hash(JSON.stringify(value));
const source = 'autohome_used_china_open', listing = '123456';
const id = hash(source + ':' + listing).slice(0, 24);
const bindingReleaseSha = '5'.repeat(40);
const raw = value => Buffer.from(JSON.stringify(value));
const readerFiles = ['data.ts', 'business-settings.ts', 'effective-market-settings.ts',
  'catalog/rates.ts', 'catalog/customs-pricing.ts', 'catalog/live-business-pricing.ts',
  'catalog/market-logistics.ts', 'catalog/city-delivery.ts', 'catalog/estimated-market-config.ts',
  'catalog/editorial.ts', 'catalog/editorial-specifications.ts', 'catalog/china-cny-price.ts',
  'encyclopedia/calculation-index.ts', 'catalog/shared-budget-prices.ts'];

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'china-pricing-context-test-'));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  const runtimeRoot = path.join(root, 'runtime'), outputDirectory = path.join(root, 'context');
  await fs.mkdir(runtimeRoot);
  for (const file of readerFiles) {
    const target = path.join(runtimeRoot, 'apps/web/lib', file);
    await fs.mkdir(path.dirname(target), {recursive: true});
    await fs.writeFile(target, '// Exact source fixture: ' + file + '\n');
  }
  const git = async args => (await exec('git', args, {cwd: runtimeRoot})).stdout.trim();
  await git(['init', '--quiet']); await git(['add', '.']);
  await git(['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'Fixture runtime']);
  const runtimeSha = await git(['rev-parse', 'HEAD']);
  const models = {'fixture:model': [{year: 2021, values: {powerHp: 120}, privateSource: 'private-encyclopedia-value'}]};
  const expectedIndexDigest = jsonHash(models);
  const bindingKey = `knowledge/encyclopedia/calculation-releases/${bindingReleaseSha}.json`;
  const indexKey = `knowledge/encyclopedia/calculation-indexes/${expectedIndexDigest}.json`;
  const china = {id: 'china', activeVersionId: 'current', savedOwnerNote: 'private-market-value', versions: [
    {id: 'current', effectiveFrom: '2026-01-01T00:00:00.000Z', status: 'active', topAvtoCommissionRub: 25000},
    {id: 'future', effectiveFrom: '2027-01-01T00:00:00.000Z', status: 'scheduled', topAvtoCommissionRub: 30000},
  ]};
  const edit = {id, market: 'china', sourceId: source, sourceOfferId: listing, status: 'visible',
    sellerPrice: {amount: 12000000, currency: 'KRW'}, specifications: {drive: 'awd', color: 'Чёрный'},
    title: 'Ручное название', photos: ['https://example.invalid/private-photo.jpg'],
    updatedBy: 'private-operator', reason: 'private-comment', version: 'china-edit-1'};
  const objects = new Map([
    [bindingKey, {version: 1, release: bindingReleaseSha, digest: expectedIndexDigest, key: indexKey}],
    [indexKey, {version: 1, digest: expectedIndexDigest, manifestDigest: '7'.repeat(64), models}],
    ['markets/markets.json', [china, null, {id: 'korea', versions: {malformed: true}}, {id: 'europe', versions: [null]}]],
    ['fees/exchange-rates.json', {updatedAt: '2026-11-24T00:00:00.000Z', rates:
      [['CNY', 125, 10], ['USD', 85, 1], ['EUR', 95, 1], ['KRW', 65, 1000], ['JPY', 55, 100]].map(([currency, cbrRate, nominal]) =>
        ({currency, cbrRate, nominal, effectiveRate: 999, rateDate: '2026-11-24', rateSource: 'cbr'}))}],
    ['catalog-editorial/current.json', {revision: 'global-1', entries: {[id]: edit, foreign: null,
      korea: {market: 'korea', sourceId: 'encar', sourceOfferId: 'other', specifications: null}}}],
    ['catalog/china-cny-prices/current.json', {version: 1, entries: {saved: {
      sourceCurrency: 'USD', sourcePrice: 1000, sourcePriceCny: 7200, usdRub: 90, cnyRub: 12.5, rateDate: '2026-11-18'}}}],
  ]);
  const requests = [], counts = new Map();
  let beforeRead = async () => {};
  const readObject = async request => {
    const {method, key, maxBytes} = request;
    assert.ok(['HEAD', 'GET'].includes(method));
    const countKey = method + ':' + key, count = (counts.get(countKey) || 0) + 1;
    counts.set(countKey, count); requests.push({...request}); await beforeRead({...request, count});
    if (!objects.has(key)) return null;
    const body = raw(objects.get(key)); assert.ok(body.length <= maxBytes);
    return {etag: '"' + hash(body) + '"', bytes: body.length, encoding: 'identity', ...(method === 'GET' ? {body} : {})};
  };
  return {root, runtimeRoot, runtimeSha, outputDirectory, objects, requests, china, edit, bindingKey, indexKey,
    beforeRead: fn => { beforeRead = fn; },
    options: {runtimeRoot, runtimeSha, outputDirectory, encyclopedia: {bindingReleaseSha, expectedIndexDigest}, readObject}};
}

const absent = async p => assert.rejects(fs.access(p), error => error.code === 'ENOENT');

test('captures complete China manual values and exact bound encyclopedia in five private files without evaluating foreign markets', async t => {
  const f = await fixture(t), result = await materializeChinaRuntimeContext(f.options);
  const read = async name => JSON.parse(await fs.readFile(path.join(result.paths.data, name), 'utf8'));
  assert.deepEqual(await read('markets/markets.json'), [f.china]);
  assert.deepEqual((await read('catalog-editorial/current.json')).entries, {[id]: f.edit});
  assert.deepEqual((await read('fees/exchange-rates.json')).rates.map(row => row.currency), ['CNY', 'EUR', 'KRW', 'USD']);
  assert.equal((await read('fees/exchange-rates.json')).rates.find(row => row.currency === 'CNY').nominal, 10);
  assert.deepEqual(await read('catalog/china-cny-prices/current.json'), f.objects.get('catalog/china-cny-prices/current.json'));
  assert.equal((await read('knowledge/encyclopedia/calculation-v1.json')).digest, f.options.encyclopedia.expectedIndexDigest);
  assert.equal(result.receipt.files.length, 5);
  assert.equal(result.receipt.runtimeSha, f.runtimeSha);
  assert.notEqual(result.receipt.runtimeSha, result.receipt.encyclopedia.bindingReleaseSha, 'Candidate source is not confused with the installed encyclopedia binding');
  assert.equal(result.receipt.storageWrites, 0); assert.equal(result.receipt.supplierRequests, 0);
  assert.equal(result.receipt.publicationReady, false); assert.equal(result.receipt.globalAtomicSnapshot, false);
  assert.equal(result.receipt.fxCaptured, false); assert.equal(result.receipt.pricingAsOf, null);
  assert.equal(result.receipt.searchAliasesIncluded, false); assert.equal(Object.hasOwn(result.receipt, 'sourceObservedAt'), false);
  assert.match(result.receipt.capturedAt, /^\d{4}-\d{2}-\d{2}T/);
  const receiptBytes = await fs.readFile(result.paths.receipt);
  assert.equal(hash(receiptBytes), result.receiptSha256);
  assert.doesNotMatch(receiptBytes.toString(), /private-market-value|private-operator|private-comment|private-encyclopedia-value|private-photo/);
  assert.equal((await fs.stat(result.paths.directory)).mode & 0o777, 0o700);
  for (const file of result.receipt.files) {
    const target = path.join(result.paths.directory, file.file), bytes = await fs.readFile(target);
    assert.equal((await fs.stat(target)).mode & 0o777, 0o600);
    assert.equal(hash(bytes), file.sha256); assert.equal(bytes.length, file.bytes);
  }
  assert.ok(f.requests.every(r => ['HEAD', 'GET'].includes(r.method)));
  assert.ok(f.requests.every(r => !/provider|manifest\.json|collection-controls|customer/.test(r.key)));
});

test('foreign market edits and unrelated currency changes do not invalidate unchanged China inputs', async t => {
  const f = await fixture(t);
  f.beforeRead(({method, key, count}) => {
    if (method !== 'GET' || count !== 2) return;
    if (key === 'markets/markets.json') f.objects.set(key, [f.china, {id: 'korea', versions: [null]}]);
    if (key === 'catalog-editorial/current.json') f.objects.set(key, {revision: 'global-2', entries: {[id]: f.edit, foreign: ['invalid']}});
    if (key === 'fees/exchange-rates.json') {
      const table = structuredClone(f.objects.get(key)); table.updatedAt = '2026-11-24T01:00:00.000Z';
      table.rates.find(row => row.currency === 'JPY').cbrRate = 75; f.objects.set(key, table);
    }
  });
  const result = await materializeChinaRuntimeContext(f.options);
  assert.equal(result.receipt.effectiveInputsRechecked, true);
  assert.equal(result.receipt.objects.filter(row => row.sharedObjectChanged).length, 3);
});

test('a China setting or manual price that changes between reads cannot seal a context', async t => {
  for (const changed of ['markets/markets.json', 'catalog-editorial/current.json']) {
    await t.test(changed, async t => {
      const f = await fixture(t);
      f.beforeRead(({method, key, count}) => {
        if (method !== 'GET' || key !== changed || count !== 2) return;
        const value = structuredClone(f.objects.get(key));
        if (key.startsWith('markets/')) value[0].versions[0].topAvtoCommissionRub++;
        else value.entries[id].sellerPrice.amount++;
        f.objects.set(key, value);
      });
      await assert.rejects(materializeChinaRuntimeContext(f.options), /china_inputs_changed/);
      await absent(f.outputDirectory);
    });
  }
});

test('all mandatory settings, every used currency and the supplied exact binding are required', async t => {
  for (const missing of ['markets/markets.json', 'fees/exchange-rates.json', 'binding', 'index', 'KRW']) {
    await t.test(missing, async t => {
      const f = await fixture(t);
      if (missing === 'KRW') f.objects.get('fees/exchange-rates.json').rates = f.objects.get('fees/exchange-rates.json').rates.filter(row => row.currency !== 'KRW');
      else f.objects.delete(missing === 'binding' ? f.bindingKey : missing === 'index' ? f.indexKey : missing);
      await assert.rejects(materializeChinaRuntimeContext(f.options), /china_runtime_context_(required_object_missing|required_rate_missing|encyclopedia_)/);
      await absent(f.outputDirectory);
    });
  }
});

test('optional absent records have explicit empty local defaults and cannot hide a new China edit during capture', async t => {
  const f = await fixture(t);
  f.objects.delete('catalog-editorial/current.json'); f.objects.delete('catalog/china-cny-prices/current.json');
  const result = await materializeChinaRuntimeContext(f.options);
  const edits = JSON.parse(await fs.readFile(path.join(result.paths.data, 'catalog-editorial/current.json'), 'utf8'));
  assert.deepEqual(edits, {revision: '0', entries: {}});
  assert.deepEqual(result.receipt.currencies, ['CNY', 'EUR', 'USD', 'RUB']);
  await fs.rm(f.outputDirectory, {recursive: true});
  f.beforeRead(({method, key, count}) => {
    if (method === 'GET' && key === 'catalog-editorial/current.json' && count === 4)
      f.objects.set(key, {revision: 'new', entries: {[id]: f.edit}});
  });
  await assert.rejects(materializeChinaRuntimeContext(f.options), /china_inputs_changed/);
  await absent(f.outputDirectory);
});

test('tampered encyclopedia models or a moving release binding are rejected', async t => {
  await t.test('model content digest', async t => {
    const f = await fixture(t); f.objects.get(f.indexKey).models.changed = [];
    await assert.rejects(materializeChinaRuntimeContext(f.options), /encyclopedia_index/);
  });
  await t.test('binding changes after GET', async t => {
    const f = await fixture(t);
    f.beforeRead(({method, key, count}) => {
      if (method === 'HEAD' && key === f.bindingKey && count === 2) f.objects.get(key).extra = 'changed';
    });
    await assert.rejects(materializeChinaRuntimeContext(f.options), /encyclopedia_changed/);
    await absent(f.outputDirectory);
  });
});

test('changed runtime code and an occupied output directory cannot be adopted', async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.runtimeRoot, 'apps/web/lib/catalog/rates.ts'), 'changed');
  await assert.rejects(materializeChinaRuntimeContext(f.options), /runtime_source_changed/);
  assert.equal(f.requests.length, 0);
  await fs.mkdir(f.outputDirectory); await fs.writeFile(path.join(f.outputDirectory, 'keep'), 'existing');
  await assert.rejects(materializeChinaRuntimeContext(f.options), /output_exists/);
  assert.equal(await fs.readFile(path.join(f.outputDirectory, 'keep'), 'utf8'), 'existing');
});

test('injected transport errors and malformed private JSON are sanitized without copying payloads into errors', async t => {
  const f = await fixture(t), secret = 'private-supplier-secret-value';
  await assert.rejects(materializeChinaRuntimeContext({...f.options, readObject: async () => { throw Error(secret); }}),
    error => error.message === 'china_runtime_context_read_failed' && !String(error.stack).includes(secret));
  const broken = Buffer.from('{"credential":"' + secret);
  await assert.rejects(materializeChinaRuntimeContext({...f.options, readObject: async ({method}) =>
    ({etag: '"broken"', bytes: broken.length, encoding: 'identity', ...(method === 'GET' ? {body: broken} : {})})}),
  error => error.message === 'china_runtime_context_invalid_json' && !String(error.stack).includes(secret));
  await absent(f.outputDirectory);
});

test('production transport signs only named REG HEAD/GET and refuses mutation, unrelated keys, redirects and error bodies', async () => {
  const secret = 'private-reader-secret', requests = [], body = raw({value: 1});
  const reader = createChinaRuntimeReader({credentials: {accessKeyId: 'test-key', secretAccessKey: secret,
    method: 'PUT', path: '/unexpected'}, fetcher: async (url, options) => {
    requests.push({url, method: options.method});
    assert.equal(url, 'https://s3.regru.cloud/avtocena-staging-8120751/migration-staging/full-20261011/markets/markets.json');
    assert.equal(options.redirect, 'error'); assert.equal(options.body, undefined);
    assert.match(options.headers.authorization, /^AWS4-HMAC-SHA256 /); assert.ok(!options.headers.authorization.includes(secret));
    return new Response(options.method === 'HEAD' ? null : body, {headers: {'content-length': String(body.length), etag: '"test"'}});
  }});
  const request = {key: 'markets/markets.json', maxBytes: 2 * 1024 ** 2};
  assert.equal((await reader({...request, method: 'GET'})).body.toString(), body.toString());
  await reader({...request, method: 'HEAD'});
  for (const method of ['PUT', 'DELETE', 'POST', 'LIST']) await assert.rejects(reader({...request, method}), /read_scope/);
  await assert.rejects(reader({...request, method: 'GET', key: 'catalog/manifest.json'}), /read_scope/);
  assert.deepEqual(requests.map(r => r.method), ['GET', 'HEAD']);
  const refused = createChinaRuntimeReader({credentials: {accessKeyId: 'test-key', secretAccessKey: secret},
    fetcher: async () => new Response(secret, {status: 302, headers: {location: 'https://supplier.example.invalid'}})});
  await assert.rejects(refused({...request, method: 'GET'}), error => error.message === 'china_runtime_context_transport_refused' && !String(error.stack).includes(secret));
});
