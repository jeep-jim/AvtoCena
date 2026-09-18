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
