import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import {collectRetiredChinaGeneration, createChinaGenerationGcStorage} from '../scripts/catalog-next/china-generation-gc.mjs';
import {createChinaState} from '../scripts/catalog-next/china-state.mjs';
import {fixture, clock, hash, copy, empty, candidate, acceptance, stateStore, nonce, owner} from './helpers/catalog-next-gc-fixture.mjs';

const policy = 'reg-retention-bounded-v1';
const deadlineAt = '2026-11-25T13:00:00.000Z';
const environment = {YC_OBJECT_STORAGE_ENDPOINT: 'https://s3.regru.cloud', YC_OBJECT_STORAGE_REGION: 'us-east-1',
  YC_OBJECT_STORAGE_BUCKET: 'avtocena-staging-8120751', YC_OBJECT_STORAGE_PREFIX: 'migration-staging/full-20261011/',
  YC_OBJECT_STORAGE_ACCESS_KEY_ID: 'test-access', YC_OBJECT_STORAGE_SECRET_ACCESS_KEY: 'test-secret'};
const acl = '<AccessControlPolicy><Owner><ID>owner</ID></Owner><AccessControlList><Grant>'
  + '<Grantee xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="CanonicalUser"><ID>owner</ID></Grantee>'
  + '<Permission>FULL_CONTROL</Permission></Grant></AccessControlList></AccessControlPolicy>';
const physical = '/avtocena-staging-8120751/migration-staging/full-20261011/';
const prefix = 'migration-staging/full-20261011/';
const turn = () => new Promise(resolve => setImmediate(resolve));

function wireFixture(f, hooks = {}) {
  const calls = [], posts = [], stats = {active: 0, maximum: 0};
  const fetcher = async (url, options) => {
    const parsed = new URL(url), key = parsed.pathname.startsWith(physical) ? parsed.pathname.slice(physical.length) : null;
    const event = {method: options.method, key, query: parsed.search}; calls.push(event);
    assert.equal(parsed.origin, 'https://s3.regru.cloud'); assert.equal(options.redirect, 'error');
    assert.match(options.headers.authorization, /^AWS4-HMAC-SHA256 Credential=test-access\//);
    stats.active++; stats.maximum = Math.max(stats.maximum, stats.active);
    try {
      await turn();
      const overridden = await hooks.request?.(event, {calls, posts, stats});
      if (overridden) return overridden;
      if (parsed.searchParams.has('policy')) return new Response('<Error><Code>NoSuchBucketPolicy</Code></Error>', {status: 404});
      if (parsed.searchParams.has('acl')) return new Response(acl, {status: key && !f.storage.objects.has(key) ? 404 : 200});
      if (options.method === 'PUT') {
        assert.equal(key, f.root + '/RETIREMENT.json'); assert.equal(options.headers['if-none-match'], '*');
        await f.storage.putRetirement(key, options.body, {ifNoneMatch: '*'}); return new Response('', {status: 200});
      }
      if (options.method === 'POST') {
        assert.equal(key, null); assert.equal(parsed.search, '?delete=');
        assert.equal(options.headers['content-md5'], createHash('md5').update(options.body).digest('base64'));
        assert(!Object.hasOwn(options.headers, 'if-match')); assert.match(options.body, /<Quiet>false<\/Quiet>/);
        const keys = [...options.body.matchAll(/<Object><Key>([^<]+)<\/Key><\/Object>/g)].map(match => {
          assert(match[1].startsWith(prefix + f.root + '/')); return match[1].slice(prefix.length);
        });
        assert(keys.length > 0); assert.equal(new Set(keys).size, keys.length); posts.push(keys);
        const result = await hooks.post?.(keys, {calls, posts, stats}); if (result) return result;
        for (const target of keys) { f.storage.objects.delete(target); await f.storage.afterDelete?.(target); }
        return new Response('<DeleteResult>' + keys.map(target => '<Deleted><Key>' + prefix + target + '</Key></Deleted>').join('') + '</DeleteResult>');
      }
      assert(['GET', 'HEAD'].includes(options.method));
      const value = f.storage.objects.get(key);
      if (!value) return new Response(null, {status: 404});
      return new Response(options.method === 'HEAD' ? null : value.data,
        {headers: {etag: value.etag, 'content-length': String(value.data.length)}});
    } finally { stats.active--; }
  };
  return {calls, posts, stats, fetcher};
}

async function execute(f, wire, extra = {}) {
  return collectRetiredChinaGeneration({...f.options, storage: undefined, environment, fetcher: wire.fetcher,
    collectionPolicy: policy, deadlineAt, ...extra});
}

async function manyPartsFixture(t) {
  const f = await fixture(t), receipt = copy(f.saved.receipt);
  const file = receipt.files.find(row => row.name === 'RUNTIME_CONTEXT.json');
  for (const part of file.parts) f.storage.objects.delete(part.key);
  const raw = Buffer.alloc(8 * 1024 * 1024, 32), compressed = gzipSync(raw), digest = createHash('sha256');
  file.parts = Array.from({length: 129}, (_, index) => {
    const last = index === 128, bytes = last ? Buffer.from('{}') : raw, body = last ? bytes : compressed;
    digest.update(bytes);
    const part = {key: `${f.root}/files/${file.name}/${index}-${hash(body)}`, bytes: body.length,
      rawBytes: bytes.length, encoding: last ? 'identity' : 'gzip', sha256: hash(body), rawSha256: hash(bytes)};
    f.storage.objects.set(part.key, {data: body, etag: '"many-' + index + '"'}); return part;
  });
  file.bytes = raw.length * 128 + 2; file.sha256 = digest.digest('hex');
  receipt.totalBytes = receipt.files.reduce((sum, row) => sum + row.bytes, 0);
  receipt.storedBytes = receipt.files.reduce((sum, row) => sum + row.parts.reduce((n, part) => n + part.bytes, 0), 0);
  const bytes = Buffer.from(JSON.stringify(receipt)); f.storage.replace(f.completeKey, bytes);
  const reference = {...f.reference, receiptSha256: hash(bytes)};
  const state = createChinaState({storage: stateStore(), now: () => clock});
  const lease = await state.acquireLease({previous: empty(), owner: owner(9999), nonce, expiresAt: deadlineAt});
  const publish = async ref => state.commit({lease, ...await state.reserve({lease,
    previous: await state.read('accepted'), previousIntent: await state.read('intent'), candidate: ref}), evidence: acceptance(ref)});
  const first = await publish(reference), second = await publish(candidate(1002)), third = await publish(candidate(1003));
  Object.assign(f, {reference, state, lease, first, second, third}); f.saved.receipt = receipt;
  f.options = {...f.options, previousAccepted: second.accepted,
    readState: async () => ({accepted: await state.read('accepted'), intent: await state.read('intent')})};
  return f;
}

test('opt-in captures with eight bounded reads and removes completion alone before exact part batch', async t => {
  const f = await fixture(t), wire = wireFixture(f);
  const result = await execute(f, wire);
  assert.equal(result.completed, true); assert.equal(wire.stats.maximum, 8); assert.equal(wire.stats.active, 0);
  assert.deepEqual(wire.posts[0], [f.completeKey]); assert.equal(wire.posts.length, 2);
  assert(wire.posts[1].every(key => key !== f.completeKey && key !== f.root + '/RETIREMENT.json'));
  const completionPost = wire.calls.findIndex(row => row.method === 'POST');
  const partPost = wire.calls.findIndex((row, index) => index > completionPost && row.method === 'POST');
  assert(wire.calls.slice(completionPost + 1, partPost).some(row => row.method === 'HEAD' && row.key === f.completeKey));
  assert.equal(result.progress.stage, 'complete'); assert.equal(result.progress.checkedObjects, result.deletedObjects);
  assert.equal(result.progress.capturedObjects, result.plannedObjects);
  assert.equal(result.progress.retirementRecordVerified, true);
  assert(!JSON.stringify(result.progress).includes(f.root));
  for (const key of f.protectedKeys) assert(f.storage.objects.has(key));
});

test('undefined policy preserves serial default and exact one-object POSTs', async t => {
  const f = await fixture(t), wire = wireFixture(f);
  const result = await execute(f, wire, {collectionPolicy: undefined, deadlineAt: undefined});
  assert.equal(result.completed, true); assert.equal(wire.stats.maximum, 1);
  assert.equal(wire.posts.length, result.deletedObjects); assert(wire.posts.every(keys => keys.length === 1));
  assert.equal(result.progress, undefined);
});

test('unknown collection policy fails before any object transport', async t => {
  const f = await fixture(t), wire = wireFixture(f);
  await assert.rejects(execute(f, wire, {collectionPolicy: 'arbitrary-parallel-delete'}), /collection_policy/);
  assert.equal(wire.calls.length, 0);
});

test('a large exact receipt produces sequential batches of at most64 with stable captured object order', async t => {
  const f = await manyPartsFixture(t), wire = wireFixture(f);
  const result = await execute(f, wire);
  const expected = [f.completeKey, ...f.saved.receipt.files.flatMap(file => file.parts.map(part => part.key))];
  assert.equal(result.completed, true); assert.deepEqual(wire.posts.flat(), expected);
  assert.equal(wire.posts[1].length, 64); assert.equal(wire.posts[2].length, 64);
  assert(wire.posts.slice(1).every(keys => keys.length <= 64)); assert.equal(wire.stats.maximum, 8);
  const saved = JSON.parse(f.storage.objects.get(f.root + '/RETIREMENT.json').data);
  assert.deepEqual(saved.objects.map(row => row.key), expected);
  assert.equal(result.progress.checkedObjects, expected.length);
});

for (const mode of ['transport', 'metadata', 'acl']) test('capture ' + mode + ' failure drains all reads before refusing seal and every deletion', async t => {
  const f = await fixture(t), target = f.saved.receipt.files.find(row => row.name === 'details.sqlite').parts[0].key;
  const wire = wireFixture(f, {request(event) {
    if (event.key !== target) return;
    if (mode === 'transport' && event.method === 'HEAD') throw Error('private transport failure');
    if (mode === 'metadata' && event.method === 'HEAD') return new Response(null, {headers: {etag: '"changed"', 'content-length': '99999'}});
    if (mode === 'acl' && event.query === '?acl=') return new Response(acl.replace('owner</ID></Grantee>', 'foreign</ID></Grantee>'));
  }});
  await assert.rejects(execute(f, wire), error => {
    assert.equal(error.report.progress.stage, 'capture'); assert.equal(error.report.progress.retirementRecordVerified, false);
    assert(error.report.progress.capturedObjects < error.report.progress.plannedObjects); return true;
  });
  assert.equal(wire.stats.active, 0); assert(!wire.calls.some(row => ['POST', 'PUT'].includes(row.method)));
  const finished = wire.calls.length; await turn(); assert.equal(wire.calls.length, finished);
  assert(!f.storage.objects.has(f.root + '/RETIREMENT.json')); assert(f.storage.objects.has(f.completeKey));
});

test('the original deadline stops new pool and HTTP admission and drains already started reads', async t => {
  const f = await fixture(t); let time = clock, admittedAtExpiry;
  const wire = wireFixture(f, {request(event, {calls}) {
    if (event.method === 'HEAD' && admittedAtExpiry === undefined) { time = deadlineAt; admittedAtExpiry = calls.length; }
  }});
  await assert.rejects(execute(f, wire, {now: () => time}), error => error.message === 'china_gc_deadline'
    && error.report.progress.stage === 'capture');
  assert.equal(wire.stats.active, 0); assert.equal(wire.calls.length, admittedAtExpiry);
  assert(!wire.calls.some(row => ['POST', 'PUT'].includes(row.method)));
});

test('lease loss after full retirement capture preserves the seal and sends no completion POST', async t => {
  const f = await fixture(t), wire = wireFixture(f); f.storage.afterRetirement = f.loseAuthority;
  await assert.rejects(execute(f, wire), /lease_lost/);
  assert(f.storage.objects.has(f.root + '/RETIREMENT.json')); assert(f.storage.objects.has(f.completeKey));
  assert.equal(wire.posts.length, 0); assert.equal(wire.stats.active, 0);
});

test('a changed part after completion is preserved and stops before the part POST', async t => {
  const f = await fixture(t), target = f.saved.receipt.files[0].parts[0].key, wire = wireFixture(f);
  f.storage.afterDelete = key => { if (key === f.completeKey) f.storage.replace(target); };
  await assert.rejects(execute(f, wire), /object_changed/);
  assert.deepEqual(wire.posts, [[f.completeKey]]); assert(f.storage.objects.has(target));
});

for (const mode of ['lease', 'state', 'retirement', 'completion']) test('final batch fence detects ' + mode + ' change after all preflight reads', async t => {
  const f = await fixture(t), parts = f.saved.receipt.files.flatMap(file => file.parts); let heads = 0;
  const wire = wireFixture(f, {async request(event, {posts}) {
    if (posts.length !== 1 || event.method !== 'HEAD' || !event.key?.includes('/files/')) return;
    if (++heads !== parts.length * 2) return;
    if (mode === 'lease') f.loseAuthority();
    if (mode === 'retirement') f.storage.replace(f.root + '/RETIREMENT.json');
    if (mode === 'completion') f.storage.objects.set(f.completeKey, {data: Buffer.from('resurrected'), etag: '"resurrected"'});
    if (mode === 'state') {
      const next = candidate(1004);
      await f.state.commit({lease: f.lease, ...await f.state.reserve({lease: f.lease,
        previous: f.third.accepted, previousIntent: f.third.intent, candidate: next}), evidence: acceptance(next)});
    }
  }});
  await assert.rejects(execute(f, wire), error => error.report.status === 'needs_reconciliation');
  assert.deepEqual(wire.posts, [[f.completeKey]]); assert.equal(wire.stats.active, 0);
  assert(parts.every(part => f.storage.objects.has(part.key)));
});

for (const mode of ['partial', 'missing', 'duplicate', 'foreign', 'transport']) test('part ' + mode + ' response stops without retry or later POST', async t => {
  const f = await fixture(t), wire = wireFixture(f, {post(keys) {
    if (keys.includes(f.completeKey)) return;
    f.storage.objects.delete(keys[0]);
    if (mode === 'transport') throw Error('unknown remote outcome');
    const rows = keys.map((key, index) => mode === 'partial' && index === 1
      ? '<Error><Key>' + prefix + key + '</Key><Code>AccessDenied</Code><Message>private error body</Message></Error>'
      : '<Deleted><Key>' + prefix + key + '</Key></Deleted>');
    if (mode === 'missing') rows.pop();
    if (mode === 'duplicate') rows[1] = rows[0];
    if (mode === 'foreign') rows[1] = '<Deleted><Key>' + prefix + 'other-root/private</Key></Deleted>';
    return new Response('<DeleteResult>' + rows.join('') + '</DeleteResult>');
  }});
  await assert.rejects(execute(f, wire), error => {
    assert.equal(error.report.status, 'needs_reconciliation'); assert.equal(error.report.completed, false);
    assert.equal(error.report.progress.stage, 'delete_parts');
    assert(!JSON.stringify(error.report).includes('private error body')); assert.equal(error.report.uncertainKey, undefined); return true;
  });
  assert.equal(wire.posts.length, 2); assert.equal(wire.stats.active, 0);
});

for (const mode of ['completion', 'parts']) test(mode + ' absence readback failure is uncertain and stops subsequent mutations', async t => {
  const f = await fixture(t), target = f.saved.receipt.files[0].parts[0].key;
  const wire = wireFixture(f, {request(event, {posts}) {
    if (event.method === 'HEAD' && (mode === 'completion' ? posts.length === 1 && event.key === f.completeKey
      : posts.length === 2 && event.key === target)) throw Error('readback unavailable');
  }});
  await assert.rejects(execute(f, wire), error => error.report.status === 'needs_reconciliation'
    && error.message === 'china_gc_delete_outcome_unknown');
  assert.equal(wire.posts.length, mode === 'completion' ? 1 : 2); assert.equal(wire.stats.active, 0);
});

test('unknown first large part batch resumes only the same retirement seal and never repeats absent keys', async t => {
  const f = await manyPartsFixture(t), acceptedBefore = await f.state.read('accepted'); let removed;
  const failed = wireFixture(f, {post(keys) {
    if (keys.includes(f.completeKey)) return;
    removed = keys.slice(0, 5); for (const key of removed) f.storage.objects.delete(key);
    throw Error('lost acknowledgement');
  }});
  await assert.rejects(execute(f, failed), error => error.report.status === 'needs_reconciliation');
  assert.equal(failed.posts.length, 2); assert.equal(failed.posts[1].length, 64);
  const seal = Buffer.from(f.storage.objects.get(f.root + '/RETIREMENT.json').data), resumed = wireFixture(f);
  const result = await execute(f, resumed);
  assert.equal(result.completed, true); assert.equal(result.alreadyAbsentObjects, 6);
  assert.equal(result.tombstonesWritten, 0); assert.equal(result.progress.capturedObjects, 0);
  assert.equal(result.progress.retirementRecordVerified, true);
  assert(resumed.posts.every(keys => keys.length <= 64 && keys.every(key => key !== f.completeKey && !removed.includes(key))));
  assert(!resumed.calls.some(row => row.method === 'PUT'));
  assert.deepEqual(f.storage.objects.get(f.root + '/RETIREMENT.json').data, seal);
  assert.deepEqual(await f.state.read('accepted'), acceptedBefore);
  for (const key of f.protectedKeys) assert(f.storage.objects.has(key));
});

test('native part capability rejects duplicates, count overflow, completion, seal and foreign roots before I/O', async t => {
  const f = await fixture(t), wire = wireFixture(f);
  const storage = createChinaGenerationGcStorage({owner: f.reference.owner, assertAuthority: async () => {},
    environment, fetcher: wire.fetcher, collectionPolicy: policy, deadlineAt, now: () => clock});
  await storage.assertPrivateBucket();
  const part = f.saved.receipt.files[0].parts[0], object = {key: part.key, size: part.bytes, sha256: part.sha256,
    etag: f.storage.objects.get(part.key).etag};
  const invalid = [[object, object], Array.from({length: 65}, (_, index) => ({...object,
    key: `${f.root}/files/source.sqlite/${index}-${part.sha256}`})), [{...object, key: f.completeKey}],
    [{...object, key: f.root + '/RETIREMENT.json'}], [{...object, key: part.key.replace('/1001/', '/9999/')}],
    [{...object, sha256: '0'.repeat(64)}]];
  const before = wire.calls.length;
  for (const values of invalid) await assert.rejects(storage.deleteExactBatch(values), /delete_batch_scope/);
  assert.equal(wire.calls.length, before); assert.equal(wire.posts.length, 0);
  const legacy = createChinaGenerationGcStorage({owner: f.reference.owner, assertAuthority: async () => {}, environment, fetcher: wire.fetcher});
  assert.equal(legacy.deleteExactBatch, undefined);
});
