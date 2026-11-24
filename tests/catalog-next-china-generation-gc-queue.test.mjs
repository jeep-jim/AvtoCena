import test from 'node:test';
import assert from 'node:assert/strict';
import {CHINA_GC_QUEUE_KEY, maintainChinaGenerationGcQueue, createChinaGenerationGcQueueStorage}
  from '../scripts/catalog-next/china-generation-gc-queue.mjs';
import {collectRetiredChinaGeneration} from '../scripts/catalog-next/china-generation-gc.mjs';
import {hash, copy, ordered, empty, clock, candidate, acceptance, fixture} from './helpers/catalog-next-gc-fixture.mjs';

const bytes = value => Buffer.from(JSON.stringify(ordered(value)));
function queueStore() {
  let queue = empty(), sequence = 0;
  const tasks = new Map(), calls = [];
  const stored = value => ({found: true, etag: '"queue-' + ++sequence + '"', sha256: hash(bytes(value)), value: copy(value)});
  const storage = {tasks, calls, beforeCas: null, afterCas: null, afterCreate: null, afterDelete: null,
    async assertPrivateBucket() { return {verified: true}; },
    async readQueue() { calls.push({method: 'readQueue'}); return copy(queue); },
    async compareAndSwapQueue(previous, next) {
      calls.push({method: 'cas', previous: copy(previous), next: copy(next)});
      await storage.beforeCas?.(previous, next);
      if (queue.etag !== previous.etag || queue.sha256 !== previous.sha256) throw Error('china_gc_queue_conflict');
      queue = stored(next); await storage.afterCas?.(previous, next);
    },
    async readTask(id) { calls.push({method: 'readTask', id}); const value = tasks.get(id);
      return value ? {found: true, etag: value.etag, data: Buffer.from(value.data), size: value.data.length} : {found: false}; },
    async createTask(id, data, condition) {
      calls.push({method: 'createTask', id}); assert.deepEqual(condition, {ifNoneMatch: '*'}); assert(!tasks.has(id));
      tasks.set(id, {data: Buffer.from(data), etag: '"task-' + ++sequence + '"'}); await storage.afterCreate?.(id);
    },
    async deleteTask(id, condition) {
      calls.push({method: 'deleteTask', id, condition}); const value = tasks.get(id); assert(value);
      assert.equal(value.etag, condition.expectedETag); assert.equal(hash(value.data), condition.expectedSha256);
      tasks.delete(id); await storage.afterDelete?.(id); return {settled: true, deleted: true};
    },
    current: () => copy(queue),
    replace: value => { queue = stored(value); },
  };
  return storage;
}
function options(f, queueStorage, extra = {}) {
  return {mode: 'drain', previousAccepted: f.second.accepted, acceptedPublication: f.third,
    readState: f.options.readState, assertAuthority: f.options.assertAuthority, now: () => clock,
    generationStorage: f.storage, queueStorage, ...extra};
}
async function publish(f, reference) {
  return f.state.commit({lease: f.lease, ...await f.state.reserve({lease: f.lease,
    previous: await f.state.read('accepted'), previousIntent: await f.state.read('intent'), candidate: reference}), evidence: acceptance(reference)});
}
const mutations = f => f.storage.calls.filter(call => ['put', 'delete'].includes(call.method));

test('enqueue-only persists the complete original witness but a small index, and never calls host or generation mutations', async t => {
  const f = await fixture(t), q = queueStore();
  const result = await maintainChinaGenerationGcQueue(options(f, q, {mode: 'enqueue-only', beforeCollect: () => assert.fail()}));
  assert.equal(result.completed, true); assert.equal(result.enqueued, 1); assert.equal(result.pending, 1);
  assert.equal(result.witnessRemembered, true);
  assert.equal(mutations(f).length, 0);
  const index = q.current().value, item = index.items[0], task = JSON.parse(q.tasks.get(item.id).data);
  assert(bytes(index).length < 1400, 'index stores references, not proof history');
  assert.deepEqual(task.previousAccepted, f.second.accepted); assert.deepEqual(task.acceptedPublication, f.third);
  assert.equal(task.reference.generationId, 'gen_china_1001_1');
  assert.equal(hash(q.tasks.get(item.id).data), item.taskSha256);
  assert.equal(Object.hasOwn(item, 'previousAccepted'), false); assert.equal(Object.hasOwn(item, 'acceptedPublication'), false);
  const repeated = await maintainChinaGenerationGcQueue(options(f, q, {mode: 'enqueue-only'}));
  assert.equal(repeated.enqueued, 0); assert.equal(q.current().value.items.length, 1); assert.equal(q.tasks.size, 1);
});

test('complete cleanup checkpoints before task removal and keeps no completed task history', async t => {
  const f = await fixture(t), q = queueStore(), events = [];
  q.afterCas = async (_before, after) => { if (after.items[0]?.phase === 'collected') events.push('checkpoint'); };
  q.afterDelete = async () => events.push('task-deleted');
  const result = await maintainChinaGenerationGcQueue(options(f, q, {beforeCollect: async args => {
    await args.assertAuthority(); events.push('host-retired'); assert.equal(mutations(f).length, 0);
    assert(Object.isFrozen(args.task) && Object.isFrozen(args.previousAccepted.value));
    return {completed: true, retiredContainers: 1, filesDeleted: 4, freedBytes: 100};
  }}));
  assert.equal(result.completed, true); assert.equal(result.collected, 1); assert.equal(result.pruned, 1); assert.equal(result.pending, 0);
  assert.equal(result.retiredContainers, 1); assert.equal(result.filesDeleted, 4); assert.equal(result.freedBytes, 100);
  assert.deepEqual(events, ['host-retired', 'checkpoint', 'task-deleted']); assert.equal(q.tasks.size, 0);
  assert.deepEqual(q.current().value.items, []); assert(f.storage.objects.has(f.root + '/RETIREMENT.json'));
  assert(!f.storage.objects.has(f.completeKey));
  const count = f.storage.calls.length;
  const repeated = await maintainChinaGenerationGcQueue(options(f, q));
  assert.equal(repeated.completed, true); assert.equal(repeated.enqueued, 0); assert.equal(repeated.collected, 0);
  assert.equal(f.storage.calls.length, count, 'remembered last publication avoids recreating a completed task');
});

test('unknown generation deletion resumes after a later acceptance has replaced the original intent', async t => {
  const f = await fixture(t), q = queueStore(); let loseResponse = true;
  f.storage.afterDelete = async () => { if (loseResponse) { loseResponse = false; throw Error('lost delete response'); } };
  const first = await maintainChinaGenerationGcQueue(options(f, q));
  assert.equal(first.completed, false); assert.equal(first.status, 'needs_reconciliation'); assert.equal(first.pending, 1);
  const originalId = q.current().value.items[0].id;
  assert.equal(q.current().value.items[0].phase, 'pending'); assert(q.tasks.has(originalId));
  assert.equal(f.storage.calls.filter(call => call.method === 'delete').length, 1);
  f.storage.afterDelete = null;
  const fourth = await publish(f, candidate(1004));
  assert.notEqual(fourth.intent.value.previous.sha256, f.second.accepted.sha256);
  const remembered = await maintainChinaGenerationGcQueue(options(f, q, {mode: 'enqueue-only', previousAccepted: undefined, acceptedPublication: undefined}));
  assert.equal(remembered.enqueued, 1); assert.equal(remembered.pending, 2);
  const second = await maintainChinaGenerationGcQueue(options(f, q, {previousAccepted: undefined, acceptedPublication: undefined}));
  // B has only a deliberately non-materialized protected fixture receipt, so
  // its separate task stops honestly. The real A generation must finish first.
  assert.equal(second.collected, 1); assert.equal(second.pruned, 1); assert.equal(second.pending, 1);
  assert(!q.tasks.has(originalId)); assert(q.current().value.items.every(item => item.id !== originalId));
  assert.deepEqual([...f.storage.objects.keys()].filter(key => key.startsWith(f.root + '/')), [f.root + '/RETIREMENT.json']);
  assert.equal(f.storage.calls.filter(call => call.method === 'delete' && call.key === f.completeKey).length, 1);
  assert.equal((await f.state.read('accepted')).sha256, fourth.accepted.sha256);
  assert(!JSON.stringify(second).includes('receiptBase64')); assert(!JSON.stringify(second).includes('uncertainKey'));
});

test('a remembered historical witness can start collection only after later publications', async t => {
  const f = await fixture(t), q = queueStore();
  await maintainChinaGenerationGcQueue(options(f, q, {mode: 'enqueue-only'}));
  assert(!f.storage.objects.has(f.root + '/RETIREMENT.json'));
  await publish(f, candidate(1004));
  const result = await maintainChinaGenerationGcQueue(options(f, q));
  assert.equal(result.completed, true); assert.equal(result.pending, 0);
  const retirement = JSON.parse(f.storage.objects.get(f.root + '/RETIREMENT.json').data);
  assert.deepEqual(retirement.acceptedPublication, f.third, 'authorization remains original, not reconstructed from the latest pointer');
});

test('a new current or pending reference protects an old queued generation before even the host callback', async t => {
  for (const pending of [false, true]) {
    const f = await fixture(t), q = queueStore();
    await maintainChinaGenerationGcQueue(options(f, q, {mode: 'enqueue-only'}));
    const again = f.reference;
    if (pending) await f.state.reserve({lease: f.lease, previous: await f.state.read('accepted'),
      previousIntent: await f.state.read('intent'), candidate: again});
    else await publish(f, again);
    const result = await maintainChinaGenerationGcQueue(options(f, q, {beforeCollect: () => assert.fail('protected host cleanup')}));
    assert.equal(result.completed, false); assert.match(result.errors[0].code, /generation_protected|state_unresolved/);
    assert.equal(q.current().value.items.length, 1); assert.equal(mutations(f).length, 0); assert(f.storage.objects.has(f.completeKey));
  }
});

test('unrelated original witness or tampered task fails before private mutations', async t => {
  const f = await fixture(t), q = queueStore(), wrong = copy(f.second.accepted); wrong.etag = '"unrelated"';
  const invalid = await maintainChinaGenerationGcQueue(options(f, q, {previousAccepted: wrong}));
  assert.equal(invalid.completed, false); assert.equal(q.tasks.size, 0); assert.equal(mutations(f).length, 0);
  await maintainChinaGenerationGcQueue(options(f, q, {mode: 'enqueue-only'}));
  const item = q.current().value.items[0], original = q.tasks.get(item.id);
  q.tasks.set(item.id, {...original, data: Buffer.from('corrupt')});
  const corrupt = await maintainChinaGenerationGcQueue(options(f, q));
  assert.equal(corrupt.completed, false); assert.equal(corrupt.errors[0].code, 'china_gc_queue_task_checksum');
  assert.equal(q.current().value.items.length, 1); assert.equal(mutations(f).length, 0);
});

test('canonical hashes alone cannot authorize a different publication nonce or another market', async t => {
  const f = await fixture(t), q = queueStore(), changed = copy(f.third);
  changed.intent.value.nonce = 'b'.repeat(32); changed.intent.sha256 = hash(bytes(changed.intent.value));
  const mismatch = await maintainChinaGenerationGcQueue(options(f, q, {acceptedPublication: changed}));
  assert.equal(mismatch.completed, false); assert.equal(mismatch.errors[0].code, 'china_gc_publication_successor');
  assert.equal(q.tasks.size, 0); assert.equal(mutations(f).length, 0);
  await maintainChinaGenerationGcQueue(options(f, q, {mode: 'enqueue-only'}));
  const index = q.current().value, item = index.items[0], task = JSON.parse(q.tasks.get(item.id).data);
  task.reference.market = 'korea'; const altered = bytes(task);
  q.tasks.set(item.id, {data: altered, etag: '"altered-task"'}); item.taskSha256 = hash(altered); q.replace(index);
  const mixed = await maintainChinaGenerationGcQueue(options(f, q, {previousAccepted: undefined, acceptedPublication: undefined}));
  assert.equal(mixed.completed, false); assert.equal(mutations(f).length, 0); assert(f.storage.objects.has(f.completeKey));
});

test('enqueue-only can restore a missing pending proof while the original intent is still available', async t => {
  const f = await fixture(t), q = queueStore();
  await maintainChinaGenerationGcQueue(options(f, q, {mode: 'enqueue-only'}));
  const index = q.current(), item = index.value.items[0], exact = Buffer.from(q.tasks.get(item.id).data);
  q.tasks.delete(item.id);
  const result = await maintainChinaGenerationGcQueue(options(f, q, {mode: 'enqueue-only', previousAccepted: undefined, acceptedPublication: undefined}));
  assert.equal(result.completed, true); assert.equal(result.enqueued, 0); assert.equal(result.pending, 1);
  assert(q.tasks.get(item.id).data.equals(exact)); assert.equal(q.current().etag, index.etag);
  assert.equal(mutations(f).length, 0);
});

test('queue failure never starts generation deletion; exact readback resolves lost create/CAS replies', async t => {
  const f = await fixture(t), q = queueStore();
  q.afterCreate = async () => { throw Error('lost task acknowledgement'); };
  q.beforeCas = async () => { throw Error('china_gc_queue_storage_transport'); };
  const failed = await maintainChinaGenerationGcQueue(options(f, q));
  assert.equal(failed.completed, false); assert.equal(failed.pending, 0); assert.equal(q.tasks.size, 1);
  assert.equal(failed.witnessRemembered, false);
  assert.equal(mutations(f).length, 0);
  q.beforeCas = null; q.afterCas = async () => { throw Error('lost queue acknowledgement'); };
  const resumed = await maintainChinaGenerationGcQueue(options(f, q));
  assert.equal(resumed.completed, true); assert.equal(resumed.pending, 0); assert.equal(q.tasks.size, 0);
  assert.equal(resumed.witnessRemembered, true);
  assert.equal(q.calls.filter(call => call.method === 'createTask').length, 1);
});

test('a concurrent queue CAS conflict is not rebased and never overwrites another index', async t => {
  const f = await fixture(t), q = queueStore(); let changed;
  q.beforeCas = async (_previous, next) => {
    changed = {...copy(next), revision: next.revision + 5, rememberedPublication: null}; q.replace(changed);
    q.beforeCas = null;
  };
  const result = await maintainChinaGenerationGcQueue(options(f, q));
  assert.equal(result.completed, false); assert.equal(result.errors[0].code, 'china_gc_queue_conflict');
  assert.deepEqual(q.current().value, changed); assert.equal(q.calls.filter(call => call.method === 'cas').length, 1);
  assert.equal(mutations(f).length, 0);
});

test('a lost task delete response resumes from the collected checkpoint without repeating host or generation cleanup', async t => {
  const f = await fixture(t), q = queueStore();
  q.afterDelete = async () => { throw Error('lost metadata deletion acknowledgement'); };
  const first = await maintainChinaGenerationGcQueue(options(f, q));
  assert.equal(first.status, 'needs_reconciliation'); assert.equal(first.pending, 1); assert.equal(q.tasks.size, 0);
  assert.equal(q.current().value.items[0].phase, 'collected');
  const mutationCount = mutations(f).length; q.afterDelete = null;
  const resumed = await maintainChinaGenerationGcQueue(options(f, q, {
    beforeCollect: () => assert.fail('host cleanup already complete'), collect: () => assert.fail('generation cleanup already complete'),
  }));
  assert.equal(resumed.completed, true); assert.equal(resumed.pruned, 1); assert.equal(resumed.pending, 0);
  assert.equal(mutations(f).length, mutationCount); assert.equal(q.calls.filter(call => call.method === 'deleteTask').length, 1);
});

test('a real job deadline leaves a durable task, and successful publication remains untouched', async t => {
  const f = await fixture(t), q = queueStore(); let time = clock;
  const accepted = (await f.state.read('accepted')).sha256;
  f.storage.afterDelete = async key => { if (key === f.completeKey) time = '2026-11-25T13:00:01.000Z'; };
  const timed = await maintainChinaGenerationGcQueue(options(f, q, {
    now: () => time, deadlineAt: '2026-11-25T13:00:00.000Z',
  }));
  assert.equal(timed.completed, false); assert.equal(timed.status, 'deadline'); assert.equal(timed.pending, 1);
  assert.equal(f.storage.calls.filter(call => call.method === 'delete').length, 1);
  assert.equal((await f.state.read('accepted')).sha256, accepted);
  f.storage.afterDelete = null;
  const resumed = await maintainChinaGenerationGcQueue(options(f, q));
  assert.equal(resumed.completed, true); assert.equal(resumed.pending, 0);
});

test('failed host retirement leaves the same task pending and performs no generation deletion', async t => {
  const f = await fixture(t), q = queueStore();
  const failed = await maintainChinaGenerationGcQueue(options(f, q, {beforeCollect: async () => { throw Error('china_host_retire_failed'); }}));
  assert.equal(failed.completed, false); assert.equal(failed.pending, 1); assert.equal(mutations(f).length, 0);
  const id = q.current().value.items[0].id;
  const incomplete = await maintainChinaGenerationGcQueue(options(f, q, {beforeCollect: async () => ({completed: false})}));
  assert.equal(incomplete.errors[0].code, 'china_gc_queue_host_cleanup_incomplete'); assert.equal(mutations(f).length, 0);
  const result = await maintainChinaGenerationGcQueue(options(f, q, {beforeCollect: async ({task}) => {
    assert.equal(task.id, id); return {completed: true};
  }}));
  assert.equal(result.completed, true); assert.equal(result.pending, 0);
});

const environment = {YC_OBJECT_STORAGE_ENDPOINT: 'https://s3.regru.cloud', YC_OBJECT_STORAGE_REGION: 'us-east-1',
  YC_OBJECT_STORAGE_BUCKET: 'avtocena-staging-8120751', YC_OBJECT_STORAGE_PREFIX: 'migration-staging/full-20261011/',
  YC_OBJECT_STORAGE_ACCESS_KEY_ID: 'test-access', YC_OBJECT_STORAGE_SECRET_ACCESS_KEY: 'test-secret'};
const acl = '<AccessControlPolicy><Owner><ID>owner</ID></Owner><AccessControlList><Grant>'
  + '<Grantee xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:type="CanonicalUser"><ID>owner</ID></Grantee>'
  + '<Permission>FULL_CONTROL</Permission></Grant></AccessControlList></AccessControlPolicy>';

test('native transport is private and exact-key scoped, uses real queue CAS and does not invent conditional DELETE', async t => {
  const f = await fixture(t), records = new Map(), wire = [], physical = '/avtocena-staging-8120751/migration-staging/full-20261011/';
  let sequence = 0;
  const fetcher = async (url, options) => {
    const parsed = new URL(url), key = parsed.pathname.startsWith(physical) ? parsed.pathname.slice(physical.length) : null;
    wire.push({method: options.method, key, query: parsed.search, headers: options.headers});
    assert.equal(parsed.host, 's3.regru.cloud'); assert.equal(options.redirect, 'error');
    assert.match(options.headers.authorization, /^AWS4-HMAC-SHA256 Credential=test-access\//);
    if (parsed.searchParams.has('policy')) return new Response('<Error><Code>NoSuchBucketPolicy</Code></Error>', {status: 404});
    if (parsed.searchParams.has('acl')) return new Response(acl, {status: key && !records.has(key) ? 404 : 200});
    if (options.method === 'PUT') {
      assert.equal(options.headers['x-amz-acl'], 'private');
      const current = records.get(key);
      if (key === CHINA_GC_QUEUE_KEY && current) assert.equal(options.headers['if-match'], current.etag.slice(1, -1));
      else { assert.equal(options.headers['if-none-match'], '*'); assert(!current); }
      records.set(key, {data: Buffer.from(options.body), etag: '"native-' + ++sequence + '"'});
      return new Response('', {status: 200});
    }
    if (options.method === 'POST') {
      assert.equal(key, null); assert.equal(parsed.search, '?delete='); assert(!Object.hasOwn(options.headers, 'if-match'));
      const objects = options.body.match(/<Object><Key>([^<]+)<\/Key><\/Object>/g); assert.equal(objects.length, 1);
      const target = objects[0].match(/<Key>([^<]+)<\/Key>/)[1];
      assert.match(target, /^migration-staging\/full-20261011\/catalog\/market-rebuild\/v1\/china\/gc\/tasks\/[a-f0-9]{64}\.json$/);
      records.delete(target.slice('migration-staging/full-20261011/'.length));
      return new Response('<DeleteResult><Deleted><Key>' + target + '</Key></Deleted></DeleteResult>');
    }
    assert.equal(options.method, 'GET'); const value = records.get(key);
    return value ? new Response(value.data, {headers: {etag: value.etag}}) : new Response(null, {status: 404});
  };
  const result = await maintainChinaGenerationGcQueue(options(f, undefined, {environment, fetcher}));
  assert.equal(result.completed, true); assert.equal(result.pending, 0);
  assert.deepEqual([...records.keys()], [CHINA_GC_QUEUE_KEY]);
  assert(wire.every(call => call.key === null || call.key === CHINA_GC_QUEUE_KEY
    || /^catalog\/market-rebuild\/v1\/china\/gc\/tasks\/[a-f0-9]{64}\.json$/.test(call.key)));
  assert(!wire.some(call => /list-type|prefix=/.test(call.query)));
  const storage = createChinaGenerationGcQueueStorage({assertAuthority: async () => {}, environment, fetcher});
  await storage.assertPrivateBucket(); const count = wire.length;
  assert.throws(() => storage.readTask('../korea/accepted'), /task_id/);
  await assert.rejects(storage.deleteTask(CHINA_GC_QUEUE_KEY, {expectedETag: '"test"', expectedSha256: '1'.repeat(64)}), /task_id/);
  assert.equal(wire.length, count);
});

test('the original GC direct call still requires a direct successor unless a valid historical witness is supplied', async t => {
  const f = await fixture(t); await publish(f, candidate(1004));
  await assert.rejects(collectRetiredChinaGeneration(f.options), /publication_successor/);
  assert.equal(mutations(f).length, 0);
  const result = await collectRetiredChinaGeneration({...f.options, acceptedPublication: f.third});
  assert.equal(result.completed, true);
});
