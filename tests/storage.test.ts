import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appendChunkedDataJson, generateId, LocalJsonStorage, resetJsonStorageForTests, writeDataJson, readDataJson } from '../apps/web/lib/data.ts';

test('LocalJsonStorage reads and writes JSON', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'avtocena-storage-'));
  const cwd = process.cwd(); process.chdir(dir); fs.mkdirSync('data');
  try {
    const storage = new LocalJsonStorage();
    await storage.writeJson('clients/clients.json', [{ id: '1' }]);
    assert.deepEqual(await storage.readJson('clients/clients.json', []), [{ id: '1' }]);
  } finally { process.chdir(cwd); resetJsonStorageForTests(); }
});

test('generated ids are unique and not timestamp-only', () => {
  const ids = new Set(Array.from({ length: 100 }, () => generateId('client')));
  assert.equal(ids.size, 100);
  assert.match([...ids][0], /^client_[0-9a-f-]{36}$/);
});

test('chunked JSON splits after 500 records and keeps index after chunk', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'avtocena-chunks-'));
  const cwd = process.cwd(); process.chdir(dir); fs.mkdirSync('data'); process.env.JSON_STORAGE_DRIVER = 'local'; resetJsonStorageForTests();
  try {
    await writeDataJson('clients/clients.json', []);
    for (let i=0;i<501;i++) await appendChunkedDataJson('clients/clients.json', { id: generateId('client'), n: i });
    const index = await readDataJson<any>('clients/clients-index.json', null);
    assert.equal(index.total, 501);
    assert.equal(index.chunks.length, 2);
    assert.equal(fs.existsSync(path.join(dir, 'data/clients', index.chunks[1].file)), true);
  } finally { process.chdir(cwd); resetJsonStorageForTests(); }
});

test('ObjectJsonStorage GET/PUT/retry/fallback and sanitized errors', async () => {
  const { ObjectJsonStorage } = await import('../apps/web/lib/data.ts?object=' + Date.now());
  process.env.YC_OBJECT_STORAGE_BUCKET = 'bucket';
  process.env.YC_OBJECT_STORAGE_ACCESS_KEY_ID = 'access';
  process.env.YC_OBJECT_STORAGE_SECRET_ACCESS_KEY = 'super-secret';
  process.env.YC_OBJECT_STORAGE_REGION = 'ru-central1';
  process.env.YC_OBJECT_STORAGE_ENDPOINT = 'https://storage.test';
  let calls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: any, init: any) => {
    calls += 1;
    if (calls === 1) return new Response('slow', { status: 503 });
    if (init.method === 'GET') return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { etag: '"v1"' } });
    return new Response('', { status: 200 });
  }) as typeof fetch;
  try {
    const storage = new ObjectJsonStorage();
    assert.deepEqual(await storage.readJson('clients/clients.json', {}), { ok: true });
    await storage.writeJson('clients/clients.json', { ok: true }, { ifMatch: '"v1"' });
    assert.ok(calls >= 3);
  } finally { globalThis.fetch = originalFetch; }

  globalThis.fetch = (async () => new Response('missing', { status: 404 })) as typeof fetch;
  try { assert.deepEqual(await new ObjectJsonStorage().readJson('missing.json', { fallback: true }), { fallback: true }); } finally { globalThis.fetch = originalFetch; }

  globalThis.fetch = (async () => new Response('bad', { status: 500 })) as typeof fetch;
  try { await assert.rejects(() => new ObjectJsonStorage().writeJson('x.json', { x: 1 }), (error: any) => !String(error.message).includes('super-secret')); } finally { globalThis.fetch = originalFetch; }
});

test('parallel chunk appends preserve both records', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'avtocena-parallel-'));
  const cwd = process.cwd(); process.chdir(dir); fs.mkdirSync('data'); process.env.JSON_STORAGE_DRIVER = 'local'; resetJsonStorageForTests();
  try {
    await Promise.all([
      appendChunkedDataJson('clients/clients.json', { id: 'client_a' }),
      appendChunkedDataJson('clients/clients.json', { id: 'client_b' })
    ]);
    const records = await (await import('../apps/web/lib/data.ts?parallel=' + Date.now())).readChunkedDataJson<any>('clients/clients.json', []);
    assert.equal(records.length, 2);
    assert.deepEqual(new Set(records.map((item: any) => item.id)), new Set(['client_a', 'client_b']));
  } finally { process.chdir(cwd); resetJsonStorageForTests(); }
});

test('mutateDataJson preserves parallel JSON mutations', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'avtocena-mutate-'));
  const cwd = process.cwd(); process.chdir(dir); fs.mkdirSync('data'); process.env.JSON_STORAGE_DRIVER = 'local'; resetJsonStorageForTests();
  const { mutateDataJson, readDataJson } = await import('../apps/web/lib/data.ts?mutate=' + Date.now());
  try {
    await Promise.all([
      mutateDataJson<any[]>('markets/markets.json', [], (items) => [...items, { id: 'a' }]),
      mutateDataJson<any[]>('markets/markets.json', [], (items) => [...items, { id: 'b' }])
    ]);
    const records = await readDataJson<any[]>('markets/markets.json', []);
    assert.deepEqual(new Set(records.map((item) => item.id)), new Set(['a', 'b']));
  } finally { process.chdir(cwd); resetJsonStorageForTests(); }
});

test('ObjectJsonStorage preserves binary content-type and relative objectKey', async () => {
  const { ObjectJsonStorage, LocalJsonStorage } = await import('../apps/web/lib/data.ts?binary=' + Date.now());
  process.env.YC_OBJECT_STORAGE_BUCKET = 'bucket';
  process.env.YC_OBJECT_STORAGE_ACCESS_KEY_ID = 'access';
  process.env.YC_OBJECT_STORAGE_SECRET_ACCESS_KEY = 'secret';
  process.env.YC_OBJECT_STORAGE_REGION = 'ru-central1';
  process.env.YC_OBJECT_STORAGE_ENDPOINT = 'https://storage.test';
  process.env.YC_OBJECT_STORAGE_PREFIX = 'crm-prefix';
  const seen: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: any, init: any) => {
    seen.push(init.headers['content-type']);
    return new Response('', { status: 200 });
  }) as typeof fetch;
  try {
    const object = new ObjectJsonStorage();
    assert.equal((await object.putBinary('contracts/uploads/templates/file.png', Buffer.from('x'), 'image/png')).objectKey, 'contracts/uploads/templates/file.png');
    assert.equal((await object.putBinary('contracts/uploads/templates/file.pdf', Buffer.from('x'), 'application/pdf')).objectKey, 'contracts/uploads/templates/file.pdf');
    assert.equal((await object.putBinary('contracts/uploads/templates/file.docx', Buffer.from('x'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')).objectKey, 'contracts/uploads/templates/file.docx');
    await object.writeJson('contracts/templates.json', { ok: true });
    assert.deepEqual(seen, ['image/png', 'application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/json; charset=utf-8']);
  } finally { globalThis.fetch = originalFetch; delete process.env.YC_OBJECT_STORAGE_PREFIX; }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'avtocena-binary-'));
  const cwd = process.cwd(); process.chdir(dir); fs.mkdirSync('data');
  try {
    const local = new LocalJsonStorage();
    const localSaved = await local.putBinary('contracts/uploads/templates/file.docx', Buffer.from('x'), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    assert.equal(localSaved.objectKey, 'contracts/uploads/templates/file.docx');
  } finally { process.chdir(cwd); }
});

test('ObjectJsonStorage binaryExists uses HEAD and putBinary conditions are idempotent-conflict aware', async () => {
  const { ObjectJsonStorage } = await import('../apps/web/lib/data.ts?head=' + Date.now());
  process.env.YC_OBJECT_STORAGE_BUCKET = 'bucket';
  process.env.YC_OBJECT_STORAGE_ACCESS_KEY_ID = 'access';
  process.env.YC_OBJECT_STORAGE_SECRET_ACCESS_KEY = 'secret';
  process.env.YC_OBJECT_STORAGE_REGION = 'ru-central1';
  process.env.YC_OBJECT_STORAGE_ENDPOINT = 'https://storage.test';
  const methods: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: any, init: any) => {
    methods.push(init.method);
    if (init.method === 'HEAD') return new Response('', { status: 200 });
    if (init.headers?.['if-none-match'] === '*') return new Response('', { status: 412 });
    return new Response('', { status: 200 });
  }) as typeof fetch;
  try {
    const storage = new ObjectJsonStorage();
    assert.equal(await storage.binaryExists('contracts/uploads/templates/file.png'), true);
    await assert.rejects(() => storage.putBinary('contracts/uploads/templates/file.png', Buffer.from('new'), 'image/png', { ifNoneMatch: '*' }), /storage_conflict/);
    assert.equal(methods[0], 'HEAD');
  } finally { globalThis.fetch = originalFetch; }
});

test('safeStoragePath rejects traversal storage keys', async () => {
  const { normalizeStorageKey, safeStoragePath } = await import('../apps/web/lib/data.ts?safe=' + Date.now());
  assert.throws(() => normalizeStorageKey('../secret.png'), /invalid_storage_key/);
  assert.throws(() => normalizeStorageKey('contracts/uploads/../secret.png'), /invalid_storage_key/);
  assert.throws(() => safeStoragePath('../../secret.png'), /invalid_storage_key/);
});
