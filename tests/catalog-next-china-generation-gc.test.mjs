import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {restorePrivateChinaGeneration} from '../scripts/catalog-next/private-generation.mjs';
import {collectRetiredChinaGeneration, createChinaGenerationGcStorage} from '../scripts/catalog-next/china-generation-gc.mjs';
import {hash, copy, empty, candidate, acceptance, fixture} from './helpers/catalog-next-gc-fixture.mjs';

test('a publication with no displaced rollback performs no object I/O', async () => {
  const result = await collectRetiredChinaGeneration({previousAccepted: empty(), readState: async () => assert.fail(),
    assertAuthority: async () => assert.fail(), storage: {getBinary: async () => assert.fail()}});
  assert.equal(result.completed, true); assert.equal(result.status, 'no_previous_rollback'); assert.equal(result.deletedObjects, 0);
});

test('only the prior rollback is collected; completion is removed first and every conditional delete uses its real ETag', async t => {
  const f = await fixture(t, {large: true});
  const before = new Map([...f.storage.objects].map(([key, value]) => [key, hash(value.data)]));
  const result = await collectRetiredChinaGeneration(f.options);
  const deleted = f.storage.calls.filter(call => call.method === 'delete');
  assert.equal(result.completed, true); assert.equal(result.completionFenceRemoved, true);
  assert.equal(result.deletedObjects, 1 + f.saved.receipt.files.reduce((count, file) => count + file.parts.length, 0));
  assert.equal(deleted[0].key, f.completeKey);
  assert(deleted.every(call => call.key.startsWith(f.root + '/') && /^"opaque-\d+"$/.test(call.condition.ifMatch)));
  assert.equal(f.storage.objects.has(f.completeKey), false);
  assert.deepEqual([...f.storage.objects.keys()].filter(key => key.startsWith(f.root + '/')), [f.root + '/RETIREMENT.json']);
  for (const key of f.protectedKeys) assert.equal(hash(f.storage.objects.get(key).data), before.get(key));
  assert.equal(result.otherMarketWrites, 0); assert.equal(result.encyclopediaWrites, 0); assert.equal(result.liveCatalogWrites, 0);
  assert.deepEqual(await fs.readFile(f.files['source.sqlite']), Buffer.alloc(17 * 1024 * 1024, 73));
});

test('current, rollback, pending references and an unrelated predecessor never authorize retirement', async t => {
  const f = await fixture(t);
  f.overrideState(f.second);
  await assert.rejects(collectRetiredChinaGeneration(f.options), /generation_protected/);
  f.overrideState(null);
  const wrong = copy(f.second.accepted); wrong.etag = '"not-the-published-predecessor"';
  await assert.rejects(collectRetiredChinaGeneration({...f.options, previousAccepted: wrong}), /publication_successor/);
  const {proof, ...candidateAgain} = f.first.accepted.value.current;
  await f.state.reserve({lease: f.lease, previous: f.third.accepted, previousIntent: f.third.intent, candidate: candidateAgain});
  await assert.rejects(collectRetiredChinaGeneration(f.options), /state_unresolved/);
  assert.equal(f.storage.calls.filter(call => ['put', 'delete'].includes(call.method)).length, 0);
});

test('a hash-bound receipt still cannot name another market and semantic descriptor mismatches stop before mutation', async t => {
  for (const options of [{badPart: true}, {badGeneration: true}]) {
    const f = await fixture(t, options);
    await assert.rejects(collectRetiredChinaGeneration(f.options), /part_descriptor|generation_binding/);
    assert.equal(f.storage.calls.filter(call => ['put', 'delete'].includes(call.method)).length, 0);
    assert(f.storage.objects.has(f.completeKey));
  }
});

test('an ETag change after retirement capture preserves the replacement and sends no delete', async t => {
  const f = await fixture(t);
  f.storage.afterRetirement = async () => f.storage.replace(f.completeKey);
  await assert.rejects(collectRetiredChinaGeneration(f.options), /object_changed/);
  assert(f.storage.objects.has(f.completeKey));
  assert.equal(f.storage.calls.filter(call => call.method === 'delete').length, 0);
});

test('lease loss after the durable retirement fence stops before the first destructive request', async t => {
  const f = await fixture(t); f.storage.afterRetirement = f.loseAuthority;
  await assert.rejects(collectRetiredChinaGeneration(f.options), /lease_lost/);
  assert(f.storage.objects.has(f.root + '/RETIREMENT.json')); assert(f.storage.objects.has(f.completeKey));
  assert.equal(f.storage.calls.filter(call => call.method === 'delete').length, 0);
});

test('a partial deletion resumes only the pinned retirement record and never recreates completion', async t => {
  const f = await fixture(t);
  f.storage.afterDelete = async key => { if (key === f.completeKey) f.loseAuthority(); };
  await assert.rejects(collectRetiredChinaGeneration(f.options), error => error.report.deletedObjects === 1 && /lease_lost/.test(error.message));
  assert(!f.storage.objects.has(f.completeKey));
  f.restoreAuthority(); f.storage.afterDelete = null;
  const result = await collectRetiredChinaGeneration(f.options);
  assert.equal(result.completed, true); assert.equal(result.alreadyAbsentObjects, 1); assert.equal(result.tombstonesWritten, 0);
  assert.equal(f.storage.calls.filter(call => call.method === 'delete' && call.key === f.completeKey).length, 1);
  assert.equal(f.storage.calls.filter(call => call.method === 'put').length, 1);
});

test('a newer accepted pointer stops in-flight cleanup even when the retired root is still unreferenced', async t => {
  const f = await fixture(t);
  f.storage.afterDelete = async key => {
    if (key !== f.completeKey) return;
    const fourth = candidate(1004);
    await f.state.commit({lease: f.lease, ...await f.state.reserve({lease: f.lease,
      previous: f.third.accepted, previousIntent: f.third.intent, candidate: fourth}), evidence: acceptance(fourth)});
  };
  await assert.rejects(collectRetiredChinaGeneration(f.options), /state_changed/);
  assert.equal(f.storage.calls.filter(call => call.method === 'delete').length, 1);
  f.storage.afterDelete = null;
  const result = await collectRetiredChinaGeneration(f.options);
  assert.equal(result.completed, true); assert.equal(result.alreadyAbsentObjects, 1);
  assert.equal(result.tombstonesWritten, 0);
  assert.equal((await f.state.read('accepted')).value.current.generationId, 'gen_china_1004_1');
});

test('an uncertain destructive response is not retried or reported complete; later exact reconciliation can continue', async t => {
  const f = await fixture(t); let interrupted = false;
  f.storage.afterDelete = async () => { if (!interrupted) { interrupted = true; throw Error('lost private response'); } };
  await assert.rejects(collectRetiredChinaGeneration(f.options), error => error.message === 'china_gc_delete_outcome_unknown'
    && error.report.status === 'needs_reconciliation' && error.report.completed === false);
  assert.equal(f.storage.calls.filter(call => call.method === 'delete').length, 1);
  f.storage.afterDelete = null;
  const result = await collectRetiredChinaGeneration(f.options);
  assert.equal(result.completed, true); assert.equal(result.alreadyAbsentObjects, 1);
  assert.equal(f.storage.calls.filter(call => call.method === 'delete' && call.key === f.completeKey).length, 1);
});

test('the existing restore completion recheck rejects an in-flight source restore after retirement', async t => {
  const f = await fixture(t), outputDirectory = path.join(f.directory, 'inflight-restore');
  const sourcePart = f.saved.receipt.files.find(file => file.name === 'source.sqlite').parts.at(-1).key;
  let retired = false;
  const reader = {assertPrivateBucket: f.storage.assertPrivateBucket,
    async getBinary(key) {
      const value = await f.storage.getBinary(key);
      if (!retired && key === sourcePart) { retired = true; await collectRetiredChinaGeneration(f.options); }
      return value;
    }};
  await assert.rejects(restorePrivateChinaGeneration({storage: reader, owner: f.reference.owner,
    expectedReceiptSha256: f.reference.receiptSha256, outputDirectory, names: ['SOURCE.json', 'source.sqlite']}));
  assert.equal(retired, true); await assert.rejects(fs.stat(outputDirectory), {code: 'ENOENT'});
  await assert.rejects(restorePrivateChinaGeneration({storage: f.storage, owner: f.reference.owner,
    expectedReceiptSha256: f.reference.receiptSha256, outputDirectory, names: ['SOURCE.json', 'source.sqlite']}));
  assert(!f.storage.objects.has(f.completeKey));
});

const environment = {YC_OBJECT_STORAGE_ENDPOINT: 'https://s3.regru.cloud', YC_OBJECT_STORAGE_REGION: 'us-east-1',
  YC_OBJECT_STORAGE_BUCKET: 'avtocena-staging-8120751', YC_OBJECT_STORAGE_PREFIX: 'migration-staging/full-20261011/',
  YC_OBJECT_STORAGE_ACCESS_KEY_ID: 'test-access', YC_OBJECT_STORAGE_SECRET_ACCESS_KEY: 'test-secret'};
const acl = '<AccessControlPolicy><Owner><ID>owner</ID></Owner><AccessControlList><Grant>'
  + '<Grantee xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="CanonicalUser"><ID>owner</ID></Grantee>'
  + '<Permission>FULL_CONTROL</Permission></Grant></AccessControlList></AccessControlPolicy>';

test('the native REG capability deletes exact fenced keys without assuming conditional DELETE support', async t => {
  const f = await fixture(t), wire = [], physical = '/avtocena-staging-8120751/migration-staging/full-20261011/';
  const fetcher = async (url, options) => {
    const parsed = new URL(url), key = parsed.pathname.startsWith(physical) ? parsed.pathname.slice(physical.length) : null;
    wire.push({method: options.method, key, query: parsed.search, headers: options.headers});
    assert.equal(parsed.host, 's3.regru.cloud'); assert.equal(options.redirect, 'error');
    assert.match(options.headers.authorization, /^AWS4-HMAC-SHA256 Credential=test-access\//);
    if (parsed.searchParams.has('policy')) return new Response('<Error><Code>NoSuchBucketPolicy</Code></Error>', {status: 404});
    if (parsed.searchParams.has('acl')) return new Response(acl, {status: key && !f.storage.objects.has(key) ? 404 : 200});
    if (options.method === 'PUT') {
      assert.equal(key, f.root + '/RETIREMENT.json'); assert.equal(options.headers['if-none-match'], '*');
      assert.equal(options.headers['x-amz-acl'], 'private');
      await f.storage.putRetirement(key, options.body, {ifNoneMatch: '*'}); return new Response('', {status: 200});
    }
    if (options.method === 'POST') {
      assert.equal(key, null); assert.equal(parsed.search, '?delete='); assert(!Object.hasOwn(options.headers, 'if-match'));
      const match = options.body.match(/<Object><Key>([^<]+)<\/Key><\/Object>/g); assert.equal(match.length, 1);
      const target = match[0].match(/<Key>([^<]+)<\/Key>/)[1];
      assert(target.startsWith('migration-staging/full-20261011/' + f.root + '/'));
      assert.match(options.body, /<Quiet>false<\/Quiet>/);
      f.storage.objects.delete(target.slice('migration-staging/full-20261011/'.length));
      return new Response('<DeleteResult><Deleted><Key>' + target + '</Key></Deleted></DeleteResult>');
    }
    assert(['GET', 'HEAD'].includes(options.method));
    const value = f.storage.objects.get(key);
    if (!value) return new Response(null, {status: 404});
    return new Response(options.method === 'HEAD' ? null : value.data,
      {headers: {etag: value.etag, 'content-length': String(value.data.length)}});
  };
  const result = await collectRetiredChinaGeneration({...f.options, storage: undefined, environment, fetcher});
  assert.equal(result.completed, true);
  assert.equal(wire.filter(call => call.method === 'POST').length, result.deletedObjects);
  assert(wire.every(call => call.key === null || call.key.startsWith(f.root + '/')));
  assert(!wire.some(call => /list-type|prefix=/.test(call.query)));
  const scoped = createChinaGenerationGcStorage({owner: f.reference.owner, assertAuthority: async () => {}, environment, fetcher});
  await scoped.assertPrivateBucket(); const before = wire.length;
  await assert.rejects(scoped.getBinary('knowledge/encyclopedia/calculation-v1.json'), /storage_key/);
  await assert.rejects(scoped.deleteExact({key: f.root + '/RETIREMENT.json', etag: '"opaque"', size: 1}, {expectedETag: '"opaque"'}), /delete_scope/);
  assert.equal(wire.length, before);
});
