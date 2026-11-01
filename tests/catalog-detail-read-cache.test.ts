import assert from 'node:assert/strict';
import test from 'node:test';
import { DetailReadCache } from '../apps/web/lib/catalog/detail-read-cache';

test('detail cache evicts by bytes and recency and does not retain oversized blocks', async () => {
  const cache = new DetailReadCache<string>({maxEntries: 8, maxBytes: 12, ttlMs: 60, concurrency: 2});
  const reads: string[] = [];
  const read = (key: string, value = 'aaaa') => cache.get(key, async () => { reads.push(key); return value; });
  await read('a'); await read('b'); await read('a'); await read('c');
  await read('a');
  assert.deepEqual(reads, ['a', 'b', 'c'], 'recent a survives; b was evicted to keep 12 serialized bytes');
  await read('b');
  await read('large', 'x'.repeat(100)); await read('large', 'x'.repeat(100));
  assert.deepEqual(reads, ['a', 'b', 'c', 'b', 'large', 'large']);
});

test('expired unrelated entries are removed and TTL starts after loading', async () => {
  let now = 0, count = 0;
  const cache = new DetailReadCache<string>({maxEntries: 2, maxBytes: 100, ttlMs: 10, concurrency: 1, now: () => now});
  const read = (key: string) => cache.get(key, async () => { count++; now += 20; return key; });
  await read('a');
  assert.equal(await read('a'), 'a'); assert.equal(count, 1, 'slow load must not expire before it returns');
  now = 31; await read('b'); await read('a');
  assert.equal(count, 3);
});

test('simultaneous lookups share reads and limit active parsing; errors can retry', async () => {
  const cache = new DetailReadCache<string>({maxEntries: 8, maxBytes: 100, ttlMs: 100, concurrency: 2});
  let active = 0, peak = 0, calls = 0;
  const releases: Array<() => void> = [];
  const load = async () => {
    calls++; active++; peak = Math.max(peak, active);
    await new Promise<void>(resolve => releases.push(resolve));
    active--; return 'value';
  };
  const first = cache.get('a', load), duplicate = cache.get('a', load);
  const second = cache.get('b', load), third = cache.get('c', load);
  assert.equal(first, duplicate); assert.equal(calls, 2);
  releases.shift()!(); await first;
  assert.equal(calls, 3); assert.equal(peak, 2);
  releases.splice(0).forEach(release => release());
  await Promise.all([second, third]);
  await assert.rejects(cache.get('bad', async () => { throw Error('storage unavailable'); }));
  assert.equal(await cache.get('bad', async () => 'retry'), 'retry');
});

test('clear prevents an older pending read from replacing the new value', async () => {
  const cache = new DetailReadCache<string>({maxEntries: 1, maxBytes: 100, ttlMs: 100, concurrency: 2});
  let release!: (value: string) => void;
  const old = cache.get('key', () => new Promise<string>(resolve => { release = resolve; }));
  cache.clear();
  assert.equal(await cache.get('key', async () => 'new'), 'new');
  release('old'); await old;
  assert.equal(await cache.get('key', async () => 'unexpected'), 'new');
});


test('optional cache sizing does not turn a successful oversized read into failure', async () => {
  const cache = new DetailReadCache<object>({maxEntries:1,maxBytes:100,ttlMs:100,concurrency:1});
  const value={toJSON(){throw new RangeError('Invalid string length');}};
  let calls=0;
  assert.equal(await cache.get('big',async()=>{calls++;return value;}),value);
  assert.equal(await cache.get('big',async()=>{calls++;return value;}),value);
  assert.equal(calls,2,'oversized values are returned but never cached');
  assert.deepEqual(await cache.get('small',async()=>({ok:true})),{ok:true});
});

test('known wire size avoids another serialization while preserving byte eviction',async()=>{
 const cache=new DetailReadCache<object>({maxEntries:5,maxBytes:10,ttlMs:10000,concurrency:1,sizeOf:()=>6});
 const value={toJSON(){throw Error('must not serialize');}};let calls=0;
 const read=(key:string)=>cache.get(key,async()=>{calls++;return value;});
 await read('a');await read('a');assert.equal(calls,1);
 await read('b');await read('a');assert.equal(calls,3);
});

test('group admission skips blocked details, keeps total bound and serves cached hits', async () => {
  const cache = new DetailReadCache<string>({maxEntries: 8, maxBytes: 1000, ttlMs: 10000, concurrency: 2, groupConcurrency: {detail: 1}});
  await cache.get('cached', async () => 'saved', 'cached', 'detail');
  const releases = new Map<string, () => void>();
  const started: string[] = [];
  let active = 0, peak = 0;
  const read = (key: string, group = '') => cache.get(key, async () => {
    started.push(key); active++; peak = Math.max(peak, active);
    await new Promise<void>(resolve => releases.set(key, resolve));
    active--; return key;
  }, key, group);
  const detail = read('detail', 'detail'), otherDetail = read('other-detail', 'detail');
  const list = read('list'), nextList = read('next-list');
  assert.deepEqual(started, ['detail', 'list']);
  assert.equal(await cache.get('cached', async () => {throw Error('cached detail loaded again');}, 'other-visitor', 'detail'), 'saved');
  releases.get('list')!(); await list;
  assert.deepEqual(started, ['detail', 'list', 'next-list']);
  releases.get('detail')!(); await detail;
  assert.deepEqual(started, ['detail', 'list', 'next-list', 'other-detail']);
  releases.get('next-list')!(); releases.get('other-detail')!();
  await Promise.all([nextList, otherDetail]);
  assert.equal(peak, 2);
});

test('group queue remains bounded, timed out entries release no capacity, failures allow retry', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const cache = new DetailReadCache<string>({maxEntries: 8, maxBytes: 1000, ttlMs: 10000, concurrency: 2, groupConcurrency: {detail: 1}, maxQueued: 1, queueTimeoutMs: 50});
  let release!: () => void;
  const first = cache.get('a', async () => {await new Promise<void>(r => release = r); throw Error('source failure');}, 'a', 'detail');
  const firstFailure = assert.rejects(first, /source failure/);
  const blocked = cache.get('b', async () => {throw Error('must not run');}, 'b', 'detail');
  assert.equal(cache.get('b', async () => 'duplicate', 'b', 'detail'), blocked);
  const timeout = assert.rejects(blocked, /detail_cache_queue_timeout/);
  await assert.rejects(cache.get('c', async () => 'overflow', 'c', 'detail'), /detail_cache_queue_full/);
  assert.equal(await cache.get('list', async () => 'list'), 'list', 'eligible list bypasses a full detail queue');
  t.mock.timers.tick(51); await timeout;
  release(); await firstFailure;
  assert.equal(await cache.get('b', async () => 'retry', 'b', 'detail'), 'retry');
});

test('serialized details can wait for their predecessor without extending list queue deadlines', async t => {
  t.mock.timers.enable({apis: ['setTimeout']});
  const cache = new DetailReadCache<string>({maxEntries: 8, maxBytes: 1000, ttlMs: 10000, concurrency: 2, groupConcurrency: {detail: 1}, queueTimeoutMs: 5000, groupQueueTimeoutMs: {detail: 50000}});
  let releaseDetail!: () => void, releaseList!: () => void;
  const first = cache.get('a', async () => {await new Promise<void>(r => releaseDetail = r); return 'a';}, 'a', 'detail');
  const second = cache.get('b', async () => 'b', 'b', 'detail');
  const list = cache.get('list', async () => {await new Promise<void>(r => releaseList = r); return 'list';});
  const excess = assert.rejects(cache.get('another-list', async () => 'must not run'), /detail_cache_queue_timeout/);
  t.mock.timers.tick(5001); await excess;
  t.mock.timers.tick(39999); releaseDetail(); await first;
  assert.equal(await second, 'b');
  releaseList(); await list;
});
