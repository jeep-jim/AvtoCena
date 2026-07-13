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
    assert.equal(fs.existsSync(path.join(dir, 'data/clients/clients-0002.json')), true);
  } finally { process.chdir(cwd); resetJsonStorageForTests(); }
});
