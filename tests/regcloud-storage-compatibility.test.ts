import test from 'node:test';
import assert from 'node:assert/strict';
import { ObjectJsonStorage, StorageConflictError } from '../apps/web/lib/data.ts';

test('REG conditional JSON and binary writes preserve conflict guards and other endpoints', async () => {
  const names = ['YC_OBJECT_STORAGE_ENDPOINT', 'YC_OBJECT_STORAGE_REGION', 'YC_OBJECT_STORAGE_BUCKET', 'YC_OBJECT_STORAGE_ACCESS_KEY_ID', 'YC_OBJECT_STORAGE_SECRET_ACCESS_KEY'];
  const before = Object.fromEntries(names.map(name => [name, process.env[name]]));
  const originalFetch = globalThis.fetch;
  try {
    process.env.YC_OBJECT_STORAGE_REGION = 'us-east-1';
    process.env.YC_OBJECT_STORAGE_BUCKET = 'synthetic-test';
    process.env.YC_OBJECT_STORAGE_ACCESS_KEY_ID = 'test-key';
    process.env.YC_OBJECT_STORAGE_SECRET_ACCESS_KEY = 'test-secret';
    let expected: string | null = null;
    let expectedNone: string | null = null;
    let status = 200;
    let calls = 0;
    globalThis.fetch = async (_url, options) => {
      calls++;
      const headers = new Headers(options?.headers);
      assert.equal(headers.get('if-match'), expected);
      assert.equal(headers.get('if-none-match'), expectedNone);
      if (expected) assert.match(headers.get('authorization')!, /SignedHeaders=[^,]*if-match/);
      return new Response('', { status });
    };
    const storage = new ObjectJsonStorage();
    for (const endpoint of ['https://s3.regru.cloud', 'https://storage.yandexcloud.net', 'https://s3.regru.cloud.example.org']) {
      process.env.YC_OBJECT_STORAGE_ENDPOINT = endpoint;
      expected = endpoint === 'https://s3.regru.cloud' ? 'abc123' : '"abc123"';
      await storage.writeJson('test.json', { v: 2 }, { ifMatch: '"abc123"' });
      await storage.putBinary('test.bin', Buffer.from('test'), 'application/octet-stream', { ifMatch: '"abc123"' });
    }
    process.env.YC_OBJECT_STORAGE_ENDPOINT = 'https://s3.regru.cloud';
    expected = 'abc123';
    await storage.writeJson('test.json', {}, { ifMatch: 'abc123' });
    for (const conflictStatus of [409, 412]) {
      status = conflictStatus;
      const count = calls;
      await assert.rejects(storage.writeJson('test.json', {}, { ifMatch: '"abc123"' }), StorageConflictError);
      await assert.rejects(storage.putBinary('test.bin', Buffer.from('test'), 'application/octet-stream', { ifMatch: '"abc123"' }), StorageConflictError);
      assert.equal(calls, count + 2, 'No retry without the original condition');
    }
    status = 200; expected = null; expectedNone = '*';
    await storage.writeJson('new.json', {}, { ifNoneMatch: '*' });
    await storage.putBinary('new.bin', Buffer.from('test'), 'application/octet-stream', { ifNoneMatch: '*' });
  } finally {
    globalThis.fetch = originalFetch;
    for (const name of names) if (before[name] === undefined) delete process.env[name]; else process.env[name] = before[name];
  }
});
