import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {inspectJapanDescCache, verifyJapanDescCacheInvocation, PROFILE, LIMIT, MARKER, OPERATION, WORKFLOW}
  from '../scripts/catalog-next/inspect-japan-desc-cache-20261128.mjs';

const now = Date.parse('2026-11-28T16:00:00.000Z');
const env = {REGCLOUD_S3_ACCESS_KEY_ID: 'fake_test_access', REGCLOUD_S3_SECRET_ACCESS_KEY: 'fake-test-secret-never-real',
  YC_OBJECT_STORAGE_ENDPOINT: 'https://must-not-be-used.invalid', AJES_API_PASSWORD: 'must-not-be-read'};
const prefix = 'https://s3.regru.cloud/avtocena-staging-8120751/migration-staging/full-20261011/';
const urls = PROFILE.entries.map(entry => prefix + entry.key);
const canary = 'private-cache-canary-never-output';
function bucket(index, change = {}) {
  const entry = PROFILE.entries[index];
  const powers = ['160', 161, '', 0, '1.5', ' 00100 ', '2501', Number.MAX_SAFE_INTEGER];
  return {hash: entry.hash, value: {page: entry.page, pageSize: 24, observedAt: '2026-11-28T15:16:17.000Z',
    stale: false, received: 24, rejected: 0,
    items: Array.from({length: 24}, (_, i) => ({id: canary + i, table: 'stats', sourcePower: powers[i % powers.length],
      finalPriceJpy: 8000 - index * 100 - i + 0.25, make: canary, model: canary,
      images: [{url: 'https://private.invalid/' + canary}], sourceEvidence: canary})),
    sql: canary, password: canary, clientIp: '192.0.2.123', ...change}};
}
const json = value => new Response(JSON.stringify(value), {status: 200});
async function run(makeResponse = index => json(bucket(index))) {
  const calls = [];
  const result = await inspectJapanDescCache({env, now: () => now, fetcher: async (url, options) => {
    calls.push({url: url.href, ...options});
    return makeResponse(urls.indexOf(url.href), options);
  }});
  return {result, calls};
}

test('fixed eight signed GETs, no fallback/listing/writes and aggregate-only output', async () => {
  const {result, calls} = await run();
  assert.equal(result.completed, true);
  assert.equal(calls.length, 8);
  assert.deepEqual(calls.map(call => call.url), urls);
  assert.equal(new Set(calls.map(call => call.url)).size, 8);
  for (const call of calls) {
    assert.equal(call.method, 'GET'); assert.equal(call.redirect, 'error');
    assert.equal(call.body, undefined); assert.equal(new URL(call.url).search, '');
    assert.equal(call.headers.host, 's3.regru.cloud');
    assert.equal(call.headers['x-amz-date'], '20261128T160000Z');
    assert.match(call.headers.authorization, /^AWS4-HMAC-SHA256 Credential=fake_test_access\/20261128\/us-east-1\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[a-f0-9]{64}$/);
    assert.equal(call.headers['accept-encoding'], 'identity');
    assert.ok(call.signal instanceof AbortSignal);
  }
  assert.deepEqual(result.aggregate.supplierPw, {atMost160: 48, over160: 72, unknown: 72});
  assert.equal(result.aggregate.rowOccurrences, 192);
  assert.equal(result.aggregate.localPowerEvaluated, false);
  assert.deepEqual(result.aggregate.priceJpy, {known: 192, unknown: 0, min: 7277.25, max: 8000.25,
    withinPagePairs: 184, withinPagesDescending: true, adjacentPagePairs: 7, adjacentPagesDescending: true});
  assert.equal(result.attribution, 'exact_cached_query_not_run_identity');
  assert.equal(result.freshnessEvaluated, false);
  assert.equal(result.supplierRequests + result.storageWrites + result.bucketListings, 0);
  assert.deepEqual(Object.keys(result.records[0]).sort(),
    ['page', 'readStatus', 'observedAt', 'stale', 'partial', 'received', 'rejected', 'rowCount'].sort());
  const text = JSON.stringify(result);
  for (const secret of [canary, env.REGCLOUD_S3_ACCESS_KEY_ID, env.REGCLOUD_S3_SECRET_ACCESS_KEY,
    env.AJES_API_PASSWORD, '192.0.2.123', 'private.invalid']) assert.equal(text.includes(secret), false);
  assert.ok(Buffer.byteLength(text) < LIMIT.outputBytes);
  assert.ok(Object.isFrozen(PROFILE) && Object.isFrozen(PROFILE.entries) && PROFILE.entries.every(Object.isFrozen));
  for (const entry of PROFILE.entries) assert.equal(entry.key,
    `catalog/partner-cache/ajes/queries/${parseInt(entry.hash.slice(0, 8), 16) % 128}.json`);
});

test('full hash in current plus three retained entries; collisions and fourth previous stay missing', async () => {
  const {result} = await run(index => {
    const expected = bucket(index), collision = {hash: 'f'.repeat(64), value: {items: [{sourcePower: '1'}]}};
    if (index === 0) return json({...collision, previous: [collision, expected, collision]});
    if (index === 1) return json({...collision, previous: [collision, collision, collision, expected]});
    if (index === 2) return json(collision);
    if (index === 3) return new Response(canary, {status: 404});
    if (index === 4) return json(bucket(index, {page: 1}));
    if (index === 5) return json({...expected, value: {...expected.value, received: 25}});
    if (index === 6) return json(bucket(index, {stale: true, partial: true}));
    return json(bucket(index, {items: [], received: 0, rejected: 0}));
  });
  assert.deepEqual(result.records.map(record => record.readStatus),
    ['matched', 'missing', 'missing', 'missing', 'entry_invalid', 'entry_invalid', 'matched', 'matched']);
  assert.equal(result.completed, false);
  assert.equal(result.aggregate.matchedPages, 3);
  assert.equal(result.aggregate.rowOccurrences, 48);
  assert.equal(result.records[6].stale, true); assert.equal(result.records[6].partial, true);
  assert.equal(result.records[7].rowCount, 0);
  assert.equal(result.aggregate.priceJpy.adjacentPagePairs, 0);
  assert.equal(result.aggregate.priceJpy.adjacentPagesDescending, null);
});

test('numeric DESC comparisons detect inversions without exposing price arrays or joining missing pages', async () => {
  const {result} = await run(index => {
    if (index === 2) return new Response(null, {status: 404});
    const saved = bucket(index);
    if (index === 0) saved.value.items[1].finalPriceJpy = 9000.5;
    if (index === 1) saved.value.items[0].finalPriceJpy = 9500.75;
    return json(saved);
  });
  assert.equal(result.completed, true);
  assert.equal(result.aggregate.priceJpy.withinPagesDescending, false);
  assert.equal(result.aggregate.priceJpy.adjacentPagesDescending, false);
  assert.equal(result.aggregate.priceJpy.adjacentPagePairs, 5);
  assert.equal(result.aggregate.priceJpy.max, 9500.75);
  assert.equal(JSON.stringify(result).includes('finalPriceJpy'), false);
});

test('malformed objects, HTTP errors, compression and secret-shaped errors fail closed', async () => {
  const {result, calls} = await run(index => {
    if (index === 0) return new Response(canary, {status: 403});
    if (index === 1) return new Response(canary, {status: 302, headers: {location: 'https://supplier.invalid'}});
    if (index === 2) return new Response(canary, {status: 200});
    if (index === 3) return new Response(new Uint8Array([255]), {status: 200});
    if (index === 4) return new Response('{}', {status: 200, headers: {'content-encoding': 'gzip'}});
    if (index === 5) throw Error(canary + env.REGCLOUD_S3_SECRET_ACCESS_KEY);
    if (index === 6) return json(bucket(index, {observedAt: canary}));
    return json(bucket(index, {items: [null], received: 1, rejected: 0}));
  });
  assert.equal(calls.length, 8);
  assert.equal(result.completed, false);
  assert.deepEqual(result.records.map(record => record.readStatus),
    ['unavailable', 'unavailable', 'body_invalid', 'body_invalid', 'encoding', 'unavailable', 'entry_invalid', 'entry_invalid']);
  assert.equal(result.aggregate.rowOccurrences, 0);
  assert.equal(JSON.stringify(result).includes(canary), false);
});

test('256KiB per object and 2MiB total are enforced both with and without content-length', async () => {
  for (const declared of [true, false]) {
    const {result} = await run(() => new Response('x'.repeat(LIMIT.objectBytes + 1),
      declared ? {headers: {'content-length': String(LIMIT.objectBytes + 1)}} : undefined));
    assert.ok(result.records.every(record => record.readStatus === 'byte_limit'));
    assert.equal(result.completed, false);
    assert.ok(result.acceptedResponseBytes <= LIMIT.totalBytes);
  }
  const base = JSON.stringify({hash: 'f'.repeat(64), value: {}}), padded = base + ' '.repeat(LIMIT.objectBytes - base.length);
  const {result} = await run(() => new Response(padded, {headers: {'content-length': String(LIMIT.objectBytes)}}));
  assert.equal(result.completed, true);
  assert.ok(result.records.every(record => record.readStatus === 'missing'));
  assert.equal(result.objectGets, 8);
  assert.equal(result.acceptedResponseBytes, LIMIT.totalBytes);
});

test('global deadline stops a fetch that ignores abort and prevents later GETs', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  let calls = 0;
  const pending = inspectJapanDescCache({env, now: () => now, fetcher: () => { calls++; return new Promise(() => {}); }});
  t.mock.timers.tick(LIMIT.totalMs);
  const result = await pending;
  assert.equal(calls, 1); assert.equal(result.objectGets, 1);
  assert.equal(result.completed, false);
  assert.equal(result.acceptedResponseBytes, 0);
  assert.equal(result.records.length, 8);
  assert.ok(result.records.every(record => record.readStatus === 'deadline'));
});

test('a crossed wall-clock deadline, missing credentials and caller targets cause no further network', async () => {
  let clock = now, calls = 0;
  const result = await inspectJapanDescCache({env, now: () => clock, fetcher: async () => {
    calls++; clock += LIMIT.totalMs; return json(bucket(0));
  }});
  assert.equal(calls, 1); assert.equal(result.acceptedResponseBytes, 0);
  assert.ok(result.records.every(record => record.readStatus === 'deadline'));
  const absent = await inspectJapanDescCache({env: {}, fetcher: () => { throw Error('must not be called'); }});
  assert.equal(absent.errorCode, 'configuration_unavailable'); assert.equal(absent.objectGets, 0);
  await assert.rejects(inspectJapanDescCache({env, keys: ['unreviewed/key'], fetcher: () => { throw Error('must not be called'); }}), /options/);
});

test('entrypoint accepts only the real fixed workflow and a separately reviewed marker-only push', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'japan-desc-cache-invocation-'));
  const git = args => execFileSync('git', ['-c', 'user.name=Offline fixture', '-c', 'user.email=fixture@example.invalid', ...args],
    {cwd: directory, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
  try {
    git(['init', '-q', '--initial-branch=main']);
    await fs.mkdir(path.join(directory, '.github/market-runs'), {recursive: true});
    await fs.writeFile(path.join(directory, 'controller.txt'), 'reviewed controller');
    git(['add', '.']); git(['commit', '-qm', 'controller']); const approved = git(['rev-parse', 'HEAD']);
    await fs.writeFile(path.join(directory, MARKER), JSON.stringify({version: 1, operation: OPERATION, approvedSourceSha: approved}));
    git(['add', '.']); git(['commit', '-qm', 'marker']); const head = git(['rev-parse', 'HEAD']);
    const event = path.join(directory, 'event.json');
    await fs.writeFile(event, JSON.stringify({before: approved, after: head, ref: 'refs/heads/main', created: false, deleted: false, forced: false}));
    const environment = {GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'push', GITHUB_WORKFLOW_REF: WORKFLOW,
      GITHUB_REPOSITORY: 'jeep-jim/AvtoCena', GITHUB_REPOSITORY_ID: '1289722938', GITHUB_REF: 'refs/heads/main',
      GITHUB_RUN_ATTEMPT: '1', GITHUB_SHA: head, GITHUB_EVENT_PATH: event};
    assert.equal(verifyJapanDescCacheInvocation({root: directory, environment}).approvedSourceSha, approved);
    for (const changed of [{GITHUB_EVENT_NAME: 'workflow_dispatch'}, {GITHUB_WORKFLOW_REF: WORKFLOW + '-other'},
      {GITHUB_RUN_ATTEMPT: '2'}, {GITHUB_REPOSITORY_ID: '1'}])
      assert.throws(() => verifyJapanDescCacheInvocation({root: directory, environment: {...environment, ...changed}}));
    await fs.writeFile(path.join(directory, 'controller.txt'), 'dirty controller');
    assert.throws(() => verifyJapanDescCacheInvocation({root: directory, environment}), /readonly_invocation_/);
  } finally { await fs.rm(directory, {recursive: true, force: true}); }
});

test('workflow injects only S3 credentials after verification and script cannot write or import application code', async () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const workflow = await fs.readFile(path.join(root, '.github/workflows/japan-desc-cache-20261128-readonly.yml'), 'utf8');
  const script = await fs.readFile(path.join(root, 'scripts/catalog-next/inspect-japan-desc-cache-20261128.mjs'), 'utf8');
  assert.match(workflow, /timeout-minutes: 2/);
  assert.match(workflow, /fetch-depth: 2/);
  assert.equal(workflow.includes('workflow_dispatch'), false);
  assert.ok(workflow.indexOf('--verify') < workflow.indexOf('secrets.REGCLOUD_S3_ACCESS_KEY_ID'));
  assert.deepEqual([...workflow.matchAll(/secrets\.([A-Z0-9_]+)/g)].map(match => match[1]),
    ['REGCLOUD_S3_ACCESS_KEY_ID', 'REGCLOUD_S3_SECRET_ACCESS_KEY']);
  assert.equal(/SSH_PRIVATE_KEY|AJES_|npm ci|curl|wget/.test(workflow), false);
  assert.equal(/from ['"](?:node:fs|.*apps\/)|writeFile|appendFile|unlink|rename|mkdir|method:\s*['"](?:POST|PUT|PATCH|DELETE)/.test(script), false);
  assert.equal((script.match(/fetcher\(/g) || []).length, 1);
});
