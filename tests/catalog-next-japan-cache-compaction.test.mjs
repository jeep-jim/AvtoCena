import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {COMPACTION_LIMITS, CHECKPOINT_KEY, planJapanCachePayload, parseJapanCacheCheckpoint,
  runJapanCacheCompaction} from '../scripts/catalog-next/japan-cache-compaction.mjs';
import {TARGET, CACHE_PREFIXES} from '../scripts/catalog-next/japan-cache-retention-audit.mjs';
import {signRawGcS3Request} from '../scripts/lib/catalog-raw-gc-s3.mjs';

const AT = Date.parse('2026-11-27T12:00:00.000Z'), DAY = 86400000;
const OLD = new Date(AT - 8 * DAY).toISOString(), FRESH = new Date(AT - 60000).toISOString();
const env = {REGCLOUD_S3_ACCESS_KEY_ID: 'OFFLINE_KEY', REGCLOUD_S3_SECRET_ACCESS_KEY: 'OFFLINE_PRIVATE_SECRET'};
const invocation = {sourceSha: 'a'.repeat(40), runId: '12345', attempt: '1', event: 'push'};
const nonce = 'b'.repeat(48), digest = bytes => createHash('sha256').update(bytes).digest('hex');
const acl = '<AccessControlPolicy xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Owner><ID>owner:private</ID></Owner><AccessControlList><Grant><Grantee xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="CanonicalUser"><ID>owner:private</ID></Grantee><Permission>FULL_CONTROL</Permission></Grant></AccessControlList></AccessControlPolicy>';
const error = name => '<Error><Code>' + name + '</Code></Error>';
const escape = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const reply = (body = '', status = 200, headers = {}) => new Response([204, 304].includes(status) ? null : body,
  {status, headers: {...([204, 304].includes(status) ? {} : {'content-length': String(Buffer.byteLength(body))}), ...headers}});
const snapshot = (observedAt = OLD, fields = {}) => ({schemaVersion: 2, stale: false, items: [{id: 'PRIVATE_VEHICLE',
  table: 'stats', source: 'PRIVATE SELECT WITH IP 203.0.113.17'}], page: 1, pageSize: 1, received: 1, rejected: 0, observedAt, ...fields});
const entry = (letter, observedAt = OLD, fields = {}) => ({hash: letter.repeat(64), value: snapshot(observedAt, fields)});
const bytes = value => Buffer.from(JSON.stringify(value));
const detail = name => CACHE_PREFIXES[0] + name + '.json';
const query = index => CACHE_PREFIXES[2] + index + '.json';
function listXml(prefix, rows, cursor, next) {
  return '<ListBucketResult><Name>' + TARGET.bucket + '</Name><Prefix>' + escape(encodeURIComponent(TARGET.prefix + prefix))
    + '</Prefix><MaxKeys>100</MaxKeys><KeyCount>' + rows.length + '</KeyCount><EncodingType>url</EncodingType><IsTruncated>'
    + Boolean(next) + '</IsTruncated>' + (cursor ? '<ContinuationToken>' + escape(cursor) + '</ContinuationToken>' : '')
    + (next ? '<NextContinuationToken>' + escape(next) + '</NextContinuationToken>' : '')
    + rows.map(row => '<Contents><Key>' + escape(encodeURIComponent(TARGET.prefix + row.key)) + '</Key><ETag>' + escape(row.etag)
      + '</ETag><Size>' + row.body.length + '</Size><LastModified>' + row.modified + '</LastModified><Type>Normal</Type></Contents>').join('')
    + '</ListBucketResult>';
}
function storageFixture(options = {}) {
  const objects = new Map(), calls = [], synthetic = new Map(), hooks = {};
  let versioningReads = 0;
  const seed = (key, value, modified = FRESH) => {
    const body = Buffer.isBuffer(value) ? Buffer.from(value) : bytes(value);
    const row = {key, body, etag: '"' + digest(body) + '"', modified}; objects.set(key, row); return row;
  };
  const fetcher = async (input, opts) => {
    const url = new URL(input), method = opts.method, headers = new Headers(opts.headers);
    assert.equal(url.origin, TARGET.endpoint); assert.equal(opts.redirect, 'error'); assert.equal(opts.cache, 'no-store');
    const physical = decodeURIComponent(url.pathname), bucket = '/' + TARGET.bucket;
    const key = physical.startsWith(bucket + '/' + TARGET.prefix) ? physical.slice((bucket + '/' + TARGET.prefix).length) : null;
    calls.push({method, key, query: Object.fromEntries(url.searchParams), headers, ...(opts.body ? {body: Buffer.from(opts.body)} : {})});
    if (hooks.beforeRequest) await hooks.beforeRequest({method, key, url, headers, opts});
    if (key === null) {
      assert.equal(physical, bucket); assert.equal(method, 'GET');
      if (url.searchParams.has('acl')) return reply(options.invalidAcl ? '<AccessControlPolicy/>' : acl);
      if (url.searchParams.has('policy')) return reply(error('NoSuchBucketPolicy'), 404);
      if (url.searchParams.has('versioning')) {
        versioningReads++;
        const status = options.versioned || options.versioningAt && versioningReads >= options.versioningAt ? '<Status>Enabled</Status>' : '';
        return reply('<VersioningConfiguration>' + status + '</VersioningConfiguration>');
      }
      if (url.searchParams.has('lifecycle')) return reply(error('NoSuchLifecycleConfiguration'), 404);
      assert.equal(url.searchParams.get('list-type'), '2');
      const prefix = url.searchParams.get('prefix').slice(TARGET.prefix.length); assert(CACHE_PREFIXES.includes(prefix));
      const cursor = url.searchParams.get('continuation-token'), offset = cursor ? Number(cursor.split(':').at(-1)) : 0;
      const ordered = [...objects.values()].filter(row => row.key.startsWith(prefix)).sort((a, b) => a.key.localeCompare(b.key));
      const rows = ordered.slice(offset, offset + 100), next = ordered.length > offset + rows.length ? 'PRIVATE_CURSOR:' + (offset + rows.length) : null;
      return reply(listXml(prefix, rows, cursor, next));
    }
    const canary = key.startsWith('catalog/operations/ajes-cache-retention-canary/v1/');
    if (canary) {
      assert.match(key, /^catalog\/operations\/ajes-cache-retention-canary\/v1\/12345\/1\/[a-f0-9]{48}\.json$/);
      assert.equal(url.searchParams.size, 0);
      const current = synthetic.get(key);
      if (method === 'GET') return current ? reply(current.body, 200, {etag: current.etag}) : reply(error('NoSuchKey'), 404);
      assert.equal(headers.get('x-amz-acl'), method === 'PUT' ? 'private' : null);
      if (method === 'DELETE') { // Actual REG proof: DELETE ignores its condition.
        assert.match(headers.get('if-match'), /^[a-f0-9]{64}$/); synthetic.delete(key); return reply('', 204);
      }
      assert.equal(method, 'PUT');
      if (headers.get('if-none-match') === '*') { if (current) return reply(error('PreconditionFailed'), 412); }
      else if (!options.ignoreCanaryPutCondition && headers.get('if-match') !== current?.etag.slice(1, -1)) return reply(error('PreconditionFailed'), 412);
      const body = Buffer.from(opts.body); assert(body.length <= 512);
      const row = {body, etag: '"' + digest(body) + '"'}; synthetic.set(key, row); return reply('', 200, {etag: row.etag});
    }
    if (key.startsWith('catalog/market-rebuild/v1/china/')) {
      assert.equal(method, 'GET', 'publication observations are read-only');
      return url.searchParams.has('acl') ? reply(acl) : reply('{}', 200, {etag: '"control"'});
    }
    assert(key === CHECKPOINT_KEY || key.startsWith('catalog/partner-cache/ajes/'));
    assert.notEqual(method, 'DELETE', 'working cache and checkpoint never have DELETE authority');
    const current = objects.get(key);
    if (method === 'GET') {
      if (!current) return reply(error('NoSuchKey'), 404);
      if (url.searchParams.has('acl')) return reply(acl);
      if (hooks.read) { const out = await hooks.read({key, current}); if (out) return out; }
      return reply(current.body, 200, {etag: current.etag, 'last-modified': current.modified});
    }
    assert.equal(method, 'PUT'); assert.equal(headers.get('content-type'), 'application/json');
    assert.equal(headers.get('x-amz-acl'), 'private'); assert.equal(url.searchParams.size, 0);
    if (hooks.beforePut) { const out = await hooks.beforePut({key, current, opts, headers}); if (out) return out; }
    const latest = objects.get(key);
    if (headers.get('if-none-match') === '*') { assert.equal(key, CHECKPOINT_KEY); if (latest) return reply(error('PreconditionFailed'), 412); }
    else {
      assert.match(headers.get('if-match'), /^[a-f0-9]{64}$/, 'PUT condition uses the verified bare format');
      if (headers.get('if-match') !== latest?.etag.slice(1, -1)) return reply(error('PreconditionFailed'), options.conflictStatus ?? 412);
    }
    const row = seed(key, Buffer.from(opts.body));
    if (hooks.afterPut) { const out = await hooks.afterPut({key, row}); if (out) return out; }
    return reply('', 200, {etag: row.etag});
  };
  return {objects, calls, synthetic, seed, fetcher, hooks};
}
function fenceFixture({errorAt = null, initialError = null, withReads = false} = {}) {
  let checks = 0;
  return {get checks() { return checks; }, create: async ({fetcher, now}) => {
    if (initialError) throw Error(initialError);
    return {summary: {status: 'resolved_committed', currentAndRollbackVerified: true,
      observationsBound: true, leaseHeld: false, stateMutations: 0}, beforeMutation: async () => {
      checks++;
      if (errorAt === checks) throw Error('japan_cache_compaction_entry_publication_changed');
      if (withReads) for (const name of ['lease', 'accepted', 'intent', 'lease']) for (const query of [{acl: ''}, {}]) {
        const signed = signRawGcS3Request({method: 'GET', host: 's3.regru.cloud', path: '/' + TARGET.bucket + '/' + TARGET.prefix
          + 'catalog/market-rebuild/v1/china/' + name + '.json', query, headers: {'accept-encoding': 'identity'}, region: 'us-east-1',
          accessKeyId: env.REGCLOUD_S3_ACCESS_KEY_ID, secretAccessKey: env.REGCLOUD_S3_SECRET_ACCESS_KEY, at: now()});
        const response = await fetcher(TARGET.endpoint + signed.canonicalPath + (signed.canonicalQuery ? '?' + signed.canonicalQuery : ''),
          {method: 'GET', headers: signed.headers, redirect: 'error'}); await response.arrayBuffer();
      }
    }};
  }};
}
const run = (fake, options = {}) => runJapanCacheCompaction({invocation, environment: env, fetcher: fake.fetcher,
  now: () => AT, nonce, createPublicationFence: fenceFixture().create, ...options});
const actualWrites = fake => fake.calls.filter(call => call.method === 'PUT' && call.key?.startsWith('catalog/partner-cache/ajes/'));
const cp = fake => parseJapanCacheCheckpoint(fake.objects.get(CHECKPOINT_KEY).body);

test('detail expiry uses original observedAt, including exactly seven days; invalid/future/new schemas stay untouched', () => {
  for (const at of [OLD, new Date(AT - 7 * DAY).toISOString()]) {
    const plan = planJapanCachePayload(bytes(snapshot(at)), 'stats', AT);
    assert.equal(plan.changed, true); assert.equal(plan.body.toString(), 'null'); assert.equal(plan.expiredEntries, 1);
  }
  for (const value of [snapshot(new Date(AT - 7 * DAY + 1).toISOString()), snapshot(FRESH), snapshot(new Date(AT + 1).toISOString()),
    snapshot('2026-02-30T00:00:00.000Z'), snapshot(OLD, {schemaVersion: 3}), snapshot(OLD, {futureField: 'retained'}),
    {observedAt: OLD, items: []}, null]) assert.equal(planJapanCachePayload(bytes(value), 'stats', AT).changed, false);
});

test('mixed query compaction preserves exact fresh hash/value source bytes including large numbers and escapes', () => {
  const root = entry('a', FRESH), previousFresh = entry('c', FRESH), old = entry('b');
  const raw = JSON.stringify({...root, previous: [old, previousFresh]}).replace('"PRIVATE_VEHICLE"', '9007199254740993')
    .replace('PRIVATE SELECT WITH IP', '\\u0050RIVATE SELECT WITH IP');
  const plan = planJapanCachePayload(Buffer.from(raw), 'queries', AT);
  assert.equal(plan.changed, true); assert.equal(plan.expiredEntries, 1); assert.equal(plan.retainedEntries, 2);
  assert(plan.body.includes(Buffer.from('9007199254740993'))); assert(plan.body.includes(Buffer.from('\\u0050RIVATE')));
  const after = JSON.parse(plan.body);
  assert.equal(after.hash, root.hash); assert.deepEqual(after.previous, [previousFresh]);
  assert.equal(after.value.observedAt, FRESH); assert.equal(after.value.items[0].id, JSON.parse(raw).value.items[0].id);
});

test('expired query root promotes the first retained entry, retains order, and all-expired becomes null', () => {
  const first = entry('b', FRESH), second = entry('d', FRESH), input = {...entry('a'), previous: [first, entry('c'), second]};
  const plan = planJapanCachePayload(bytes(input), 'queries', AT);
  assert.deepEqual(JSON.parse(plan.body), {...first, previous: [second]}); assert.equal(plan.expiredEntries, 2);
  assert.equal(planJapanCachePayload(bytes({...entry('a'), previous: [entry('b')]}), 'queries', AT).body.toString(), 'null');
  const unchanged = {...entry('a', FRESH), previous: [first]};
  assert.equal(planJapanCachePayload(bytes(unchanged), 'queries', AT).changed, false);
});

test('one unknown/future/invalid previous entry protects the entire bucket; extra history is never silently dropped', () => {
  const cases = [null, {...entry('b'), extra: 'unknown'}, entry('b', new Date(AT + 1).toISOString()),
    {hash: 'b'.repeat(64), value: {observedAt: OLD, items: []}}, entry('a')];
  for (const previous of cases) assert.equal(planJapanCachePayload(bytes({...entry('a'), previous: [previous]}), 'queries', AT).changed, false);
  assert.equal(planJapanCachePayload(bytes({...entry('a'), previous: ['b', 'c', 'd', 'e'].map(letter => entry(letter))}), 'queries', AT).changed, false);
  assert.equal(planJapanCachePayload(Buffer.from('{not-private-json'), 'queries', AT).changed, false);
});

test('bounded run compacts payloads, checks hot mixed buckets, leaves fresh data, and reports only confirmed logical bytes', async () => {
  const fake = storageFixture(), fence = fenceFixture();
  fake.seed(detail('expired'), snapshot(), FRESH); fake.seed(CACHE_PREFIXES[1] + 'expired.json', snapshot());
  fake.seed(detail('fresh'), snapshot(FRESH)); const freshBefore = fake.objects.get(detail('fresh')).body;
  fake.seed(query(0), {...entry('a', FRESH), previous: [entry('b')]}, FRESH);
  const beforeBytes = [...fake.objects.values()].reduce((sum, row) => sum + row.body.length, 0);
  const report = await run(fake, {createPublicationFence: fence.create});
  assert.equal(report.status, 'scan_cycle_complete'); assert.equal(report.completed, true); assert.equal(report.partial, false);
  assert.equal(report.payloadsCompacted, 3); assert.equal(report.expiredEntriesRemoved, 3);
  assert.equal(report.capability.currentObjectConditionalPutVerified, true);
  assert.equal(report.capability.currentObjectConditionalDeleteVerified, false);
  assert.equal(fake.objects.get(detail('expired')).body.toString(), 'null');
  assert(fake.objects.get(detail('fresh')).body.equals(freshBefore));
  assert.deepEqual(JSON.parse(fake.objects.get(query(0)).body), entry('a', FRESH));
  const afterBytes = [...fake.objects.values()].filter(row => row.key !== CHECKPOINT_KEY).reduce((sum, row) => sum + row.body.length, 0);
  assert.equal(report.logicalPayloadBytesReduced, beforeBytes - afterBytes);
  assert.equal(report.objectKeysDeleted, 0); assert.equal(report.hostDiskMeasured, false); assert.equal(report.sourceRequests, 0);
  assert.equal(cp(fake).scan.prefixIndex, 3); assert.equal(fake.synthetic.size, 0);
  assert.equal(fence.checks, fake.calls.filter(row => row.method === 'PUT' && !row.key.includes('-canary/')).length);
  const safe = JSON.stringify(report);
  for (const forbidden of ['PRIVATE_', '203.0.113.17', 'SELECT', CHECKPOINT_KEY, detail('expired'), env.REGCLOUD_S3_SECRET_ACCESS_KEY, nonce])
    assert.equal(safe.includes(forbidden), false, forbidden);
  assert(Buffer.byteLength(safe) < COMPACTION_LIMITS.reportBytes);
});

test('schedule/manual cannot activate a missing checkpoint; exact marker push is the sole initializer', async () => {
  for (const event of ['schedule', 'workflow_dispatch']) {
    const fake = storageFixture(); fake.seed(detail('old'), snapshot());
    const report = await run(fake, {invocation: {...invocation, event}});
    assert.equal(report.status, 'deferred'); assert.equal(report.reason, 'not_initialized');
    assert(fake.calls.every(row => row.method === 'GET')); assert.equal(fake.synthetic.size, 0);
  }
});

test('unverified native CAS, public ACL, and versioned buckets cannot compact or initialize', async () => {
  for (const settings of [{ignoreCanaryPutCondition: true}, {invalidAcl: true}, {versioned: true}]) {
    const fake = storageFixture(settings); fake.seed(detail('old'), snapshot());
    const report = await run(fake);
    assert.equal(report.status, 'failed'); assert.equal(actualWrites(fake).length, 0); assert.equal(fake.objects.has(CHECKPOINT_KEY), false);
    assert.equal(report.logicalPayloadBytesReduced, 0);
    if (settings.versioned || settings.invalidAcl) assert(fake.calls.every(row => row.method === 'GET'));
  }
});

test('publication guard precedes all synthetic/cache writes and rechecks every payload/checkpoint mutation', async () => {
  const fake = storageFixture(); fake.seed(detail('old'), snapshot());
  const initial = await run(fake, {createPublicationFence: fenceFixture({initialError: 'japan_cache_compaction_entry_lease_busy'}).create});
  assert.equal(initial.status, 'deferred'); assert(fake.calls.every(row => row.method === 'GET'));
  const next = storageFixture(); next.seed(detail('old'), snapshot());
  const changed = await run(next, {createPublicationFence: fenceFixture({errorAt: 3}).create});
  assert.equal(changed.errorCode, 'japan_cache_compaction_entry_publication_changed'); assert.equal(actualWrites(next).length, 0);
  assert.equal(changed.logicalPayloadBytesReduced, 0); assert.equal(cp(next).scan.page.position, 0);
});

test('concurrent runtime PUT wins over stale cache If-Match; 409/412 are skips, never unconditional retries', async () => {
  for (const conflictStatus of [409, 412]) {
    const fake = storageFixture({conflictStatus}), key = detail('race'); fake.seed(key, snapshot());
    let fresh;
    fake.hooks.beforePut = ({key: target}) => { if (target === key) { fresh = fake.seed(key, snapshot(FRESH)); } };
    const report = await run(fake);
    assert.equal(actualWrites(fake).length, 1); assert.equal(report.payloadsCompacted, 0); assert.equal(report.concurrentChanges, 1);
    assert.equal(report.logicalPayloadBytesReduced, 0); assert(fake.objects.get(key).body.equals(fresh.body));
  }
});

test('lost PUT acknowledgement is reconciled by exact readback without a retry', async () => {
  const fake = storageFixture(), key = detail('lost'); const prior = fake.seed(key, snapshot());
  fake.hooks.afterPut = ({key: target}) => { if (target === key) throw Error('PRIVATE SQL IP 203.0.113.17 lost ACK'); };
  const report = await run(fake);
  assert.equal(actualWrites(fake).length, 1); assert.equal(report.payloadsCompacted, 1); assert.equal(report.reconciledWrites, 1);
  assert.equal(report.logicalPayloadBytesReduced, prior.body.length - 4); assert.equal(report.unconfirmedWrites, 0);
});

test('lost request not applied and a fresh concurrent post-PUT value never count as logical reduction', async () => {
  for (const applied of [false, true]) {
    const fake = storageFixture(), key = detail('ambiguous'); fake.seed(key, snapshot());
    if (!applied) fake.hooks.beforePut = ({key: target}) => { if (target === key) throw Error('PRIVATE request lost before storage'); };
    else fake.hooks.afterPut = ({key: target}) => { if (target === key) fake.seed(key, snapshot(FRESH)); };
    const report = await run(fake);
    assert.equal(actualWrites(fake).length, 1); assert.equal(report.logicalPayloadBytesReduced, 0);
    assert.equal(report.payloadsCompacted, 0); assert.equal(report.unconfirmedWrites, 1);
    assert.deepEqual(JSON.parse(fake.objects.get(key).body), snapshot(applied ? FRESH : OLD));
  }
});

test('failed readback leaves the position pending; a new run resumes safely and does not double-count', async () => {
  const fake = storageFixture(), key = detail('pending'); fake.seed(key, snapshot()); let applied = false;
  fake.hooks.afterPut = ({key: target}) => { if (target === key) { applied = true; throw Error('private lost ack'); } };
  fake.hooks.read = ({key: target}) => { if (target === key && applied) throw Error('private readback lost'); };
  const report = await run(fake);
  assert.equal(report.status, 'failed'); assert.equal(report.completed, false); assert.equal(report.logicalPayloadBytesReduced, 0);
  assert.equal(report.unconfirmedWrites, 1); assert.equal(cp(fake).scan.page.position, 0);
  fake.hooks.afterPut = null; fake.hooks.read = null;
  const resumed = await run(fake, {invocation: {...invocation, event: 'schedule'}, nonce: 'c'.repeat(48)});
  assert.equal(resumed.status, 'scan_cycle_complete'); assert.equal(resumed.resumed, true);
  assert.equal(resumed.logicalPayloadBytesReduced, 0); assert.equal(resumed.skippedNull, 1);
  assert.equal(actualWrites(fake).length, 1);
});

test('lost checkpoint acknowledgement is read back; a real checkpoint CAS conflict stops before cache writes', async () => {
  const fake = storageFixture(); fake.seed(detail('old'), snapshot());
  fake.hooks.afterPut = ({key}) => { if (key === CHECKPOINT_KEY) throw Error('private checkpoint ACK lost'); };
  assert.equal((await run(fake)).status, 'scan_cycle_complete');
  const race = storageFixture(); race.seed(detail('old'), snapshot());
  race.hooks.beforePut = ({key, opts}) => { if (key === CHECKPOINT_KEY) race.seed(key, Buffer.from(opts.body)); };
  const report = await run(race);
  assert.equal(report.errorCode, 'japan_cache_compaction_checkpoint_conflict'); assert.equal(actualWrites(race).length, 0);
});

test('checkpoint schema forbids off-scope keys, unbounded pending pages, unknown fields and opaque cursor injection', async () => {
  const fake = storageFixture(); await run(fake); const original = cp(fake);
  const mutations = [value => { value.extra = 'private'; }, value => { value.scan = {prefixIndex: 0, cursor: null,
    page: {keys: ['catalog/manifest.json'], position: 0, next: null}}; }, value => { value.scan = {prefixIndex: 0, cursor: 'x'.repeat(4097), page: null}; },
  value => { value.scan = {prefixIndex: 0, cursor: null, page: {keys: Array.from({length: 101}, (_, i) => detail('x' + i)), position: 0, next: null}}; },
  value => { value.policySha256 = '0'.repeat(64); }, value => { value.scan = {prefixIndex: 3, cursor: 'private', page: null}; }];
  for (const mutate of mutations) { const value = structuredClone(original); mutate(value); assert.throws(() => parseJapanCacheCheckpoint(bytes(value)), /checkpoint_schema/); }
});

test('global budgets include publication reads, canary, metadata, payloads and checkpoint; bounded runs eventually complete a cycle', async () => {
  const fake = storageFixture();
  for (let i = 0; i < 110; i++) fake.seed(detail('old-' + String(i).padStart(3, '0')), snapshot());
  fake.seed(query(0), {...entry('a', FRESH), previous: [entry('b')]});
  let finished = false, total = 0, firstPending = false;
  for (let attempt = 0; attempt < 12 && !finished; attempt++) {
    const report = await run(fake, {invocation: {...invocation, event: attempt ? 'schedule' : 'push'},
      nonce: digest('run-' + attempt).slice(0, 48), createPublicationFence: fenceFixture({withReads: true}).create});
    assert(report.requests.requests <= 500); assert(report.requests.requestBytes + report.requests.responseBytes <= COMPACTION_LIMITS.bytes);
    assert(report.requests.cachePutAttempts <= 100); assert(report.metadataPages <= 8); assert.equal(report.errorCode, undefined);
    total += report.payloadsCompacted; finished = report.scanCycleCompleted;
    if (!attempt) { firstPending = cp(fake).scan.page?.position > 0; assert.equal(report.status, 'bounded_partial'); }
    assert.equal(JSON.stringify(report).includes('PRIVATE_CURSOR'), false);
  }
  assert.equal(firstPending, true); assert.equal(finished, true); assert.equal(total, 111);
  assert.deepEqual(JSON.parse(fake.objects.get(query(0)).body), entry('a', FRESH));
  assert.equal(actualWrites(fake).length, 111);
});

test('LIST page budget resumes its private cursor and skips unrecognized keys without reading their bodies', async () => {
  const fake = storageFixture();
  for (let i = 0; i < 850; i++) fake.seed(CACHE_PREFIXES[0] + 'unknown/' + String(i).padStart(3, '0'), snapshot());
  const first = await run(fake);
  assert.equal(first.metadataPages, 8); assert.equal(first.listedObjects, 800); assert.equal(first.skippedUnknownKeys, 800);
  assert.equal(first.status, 'bounded_partial'); assert.equal(cp(fake).scan.cursor, 'PRIVATE_CURSOR:800');
  const next = await run(fake, {invocation: {...invocation, event: 'schedule'}, nonce: 'c'.repeat(48)});
  assert.equal(next.scanCycleCompleted, true); assert.equal(next.listedObjects, 50);
  assert(fake.calls.filter(row => row.key?.startsWith(CACHE_PREFIXES[0])).length === 0);
});

test('oversized bodies and unknown payloads are skipped, never replaced; source/control requests stay allowlisted', async () => {
  const fake = storageFixture(); fake.seed(detail('oversized'), Buffer.alloc(COMPACTION_LIMITS.detailBytes + 1, 32));
  fake.seed(query(0), {hash: 'a'.repeat(64), value: {observedAt: OLD, items: []}});
  const report = await run(fake);
  assert.equal(report.inspectionFailures, 1); assert.equal(report.skippedUnknownPayloads, 1); assert.equal(actualWrites(fake).length, 0);
  const foreign = storageFixture();
  const blocked = await run(foreign, {createPublicationFence: async ({fetcher}) => {
    await fetcher('https://ajes.example.invalid/source', {method: 'GET', redirect: 'error'});
    throw Error('unreachable');
  }});
  assert.equal(blocked.status, 'failed'); assert.equal(blocked.errorCode, 'japan_cache_compaction_state_read_only');
  assert(foreign.calls.every(call => call.key === null || call.key === CHECKPOINT_KEY));
});

test('a changed versioning state closes the gate before the actual cache PUT', async () => {
  const fake = storageFixture(); fake.seed(detail('old'), snapshot());
  let initial = true;
  fake.hooks.beforePut = ({key}) => { if (key === CHECKPOINT_KEY && initial) { initial = false; fake.hooks.beforeRequest = ({key: at, url}) => {
    if (at === null && url.searchParams.has('versioning')) throw Error('private settings unavailable');
  }; } };
  const report = await run(fake);
  assert.equal(actualWrites(fake).length, 0); assert.equal(report.logicalPayloadBytesReduced, 0); assert.equal(report.partial, true);
});

test('deadline bounds the whole operation, including fresh capability verification', async () => {
  const fake = storageFixture(); let clock = AT;
  fake.hooks.beforeRequest = () => { clock += 15000; };
  const report = await run(fake, {now: () => clock});
  assert.equal(report.status, 'bounded_partial'); assert.equal(actualWrites(fake).length, 0);
  assert(report.requests.requests <= 8); assert.equal(report.logicalPayloadBytesReduced, 0);
});

test('configuration, credentials, corrupt checkpoint and transport failures report failed while safe deferrals remain distinct', async () => {
  const configured = storageFixture();
  const wrongInvocation = await run(configured, {invocation: {...invocation, sourceSha: 'invalid'}});
  assert.equal(wrongInvocation.status, 'failed'); assert.equal(wrongInvocation.errorCode, 'japan_cache_compaction_configuration');
  assert.equal(configured.calls.length, 0);
  const credentials = await run(storageFixture(), {environment: {}});
  assert.equal(credentials.status, 'failed'); assert.equal(credentials.errorCode, 'japan_cache_compaction_credentials');
  const corrupt = storageFixture(); corrupt.seed(CHECKPOINT_KEY, {private: 'PRIVATE_CORRUPT_CURSOR'});
  const invalid = await run(corrupt);
  assert.equal(invalid.status, 'failed'); assert.equal(invalid.errorCode, 'japan_cache_compaction_checkpoint_schema');
  assert.equal(JSON.stringify(invalid).includes('PRIVATE_CORRUPT_CURSOR'), false); assert.equal(actualWrites(corrupt).length, 0);
  const broken = storageFixture(); broken.hooks.beforeRequest = () => { throw Error('PRIVATE_SECRET SELECT 203.0.113.17'); };
  const unavailable = await run(broken);
  assert.equal(unavailable.status, 'failed'); assert.equal(unavailable.errorCode, 'japan_cache_compaction_storage_transport');
  assert.equal(JSON.stringify(unavailable).includes('PRIVATE_SECRET'), false);
});

test('duplicate expiry metadata and query-entry keys are unknown shapes, not deletion authority', () => {
  const duplicateDetail = JSON.stringify(snapshot()).replace('"observedAt":', '"observedAt":"' + FRESH + '","observedAt":');
  assert.equal(planJapanCachePayload(Buffer.from(duplicateDetail), 'stats', AT).changed, false);
  const duplicateEntry = JSON.stringify({...entry('a'), previous: [entry('b', FRESH)]}).replace('"hash":', '"hash":"' + 'f'.repeat(64) + '","hash":');
  assert.equal(planJapanCachePayload(Buffer.from(duplicateEntry), 'queries', AT).changed, false);
  const duplicateValue = JSON.stringify(entry('a')).replace('"observedAt":', '"observedAt":"' + FRESH + '","observedAt":');
  assert.equal(planJapanCachePayload(Buffer.from(duplicateValue), 'queries', AT).changed, false);
});

test('exact request/declared-byte exhaustion remains bounded_partial and performs no mutation', async () => {
  for (const exhaustBytes of [false, true]) {
    const fake = storageFixture();
    const fetcher = async (input, options) => {
      const url = new URL(input);
      if (exhaustBytes && url.pathname.endsWith('/china/accepted.json')) return reply(' '.repeat(COMPACTION_LIMITS.metadataBytes));
      return fake.fetcher(input, options);
    };
    const report = await run(fake, {fetcher, createPublicationFence: async ({fetcher: bounded}) => {
      const signed = signRawGcS3Request({method: 'GET', host: 's3.regru.cloud', path: '/' + TARGET.bucket + '/' + TARGET.prefix
        + 'catalog/market-rebuild/v1/china/accepted.json', region: 'us-east-1', at: AT,
        accessKeyId: env.REGCLOUD_S3_ACCESS_KEY_ID, secretAccessKey: env.REGCLOUD_S3_SECRET_ACCESS_KEY});
      for (let i = 0; i < 501; i++) {
        const response = await bounded(TARGET.endpoint + signed.canonicalPath, {method: 'GET', headers: signed.headers, redirect: 'error'});
        await response.arrayBuffer();
      }
      throw Error('unreachable');
    }});
    assert.equal(report.status, 'bounded_partial'); assert.equal(report.reason, 'bounded_run');
    assert.equal(report.errorCode, 'japan_cache_compaction_budget_exhausted');
    assert(report.requests.requests <= 500); assert(report.requests.responseBytes + report.requests.requestBytes <= COMPACTION_LIMITS.bytes);
    if (!exhaustBytes) assert.equal(report.requests.requests, 500);
    assert(fake.calls.every(call => call.method === 'GET')); assert.equal(actualWrites(fake).length, 0);
  }
});
