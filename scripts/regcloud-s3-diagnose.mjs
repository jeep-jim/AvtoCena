import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ObjectJsonStorage, StorageConflictError } from '../apps/web/lib/data.ts';

// Diagnose only newly generated synthetic objects. Never weaken the production adapter.
let step = 'configuration';
try {
  assert.equal(process.env.YC_OBJECT_STORAGE_ENDPOINT, 'https://s3.regru.cloud');
  assert.equal(process.env.YC_OBJECT_STORAGE_BUCKET, 'avtocena-staging-8120751');
  assert.equal(process.env.YC_OBJECT_STORAGE_PREFIX, 'migration-staging/compatibility/');
  for (const key of ['YC_OBJECT_STORAGE_REGION', 'YC_OBJECT_STORAGE_ACCESS_KEY_ID', 'YC_OBJECT_STORAGE_SECRET_ACCESS_KEY']) assert.ok(process.env[key]);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const response = await originalFetch(url, init);
    const errorBody = response.ok ? '' : await response.clone().text();
    const code = errorBody.match(/<Code>([A-Za-z0-9_]+)<\/Code>/)?.[1] || '';
    const headers = new Headers(init?.headers);
    // Only status and synthetic ETag format, never URL, authorization, key or response body.
    console.log(JSON.stringify({ step, method: init?.method || 'GET', status: response.status, code,
      ifMatchQuoted: headers.has('if-match') ? headers.get('if-match').startsWith('"') : null,
      responseEtagQuoted: response.headers.has('etag') ? response.headers.get('etag').startsWith('"') : null }));
    return response;
  };
  const storage = new ObjectJsonStorage();
  const prefix = `diagnostic-${randomUUID()}`;
  for (const format of ['unchanged', 'quoted', 'unquoted']) {
    const key = `${prefix}/${format}.json`;
    step = `${format}:create`;
    await storage.writeJson(key, { version: 1 }, { ifNoneMatch: '*' });
    const first = await storage.readJsonWithMeta(key, null);
    assert.ok(first.etag);
    step = `${format}:duplicate-create`;
    await assert.rejects(storage.writeJson(key, { version: 999 }, { ifNoneMatch: '*' }), StorageConflictError);
    const after = await storage.readJsonWithMeta(key, null);
    console.log(JSON.stringify({ step, duplicatePreservedBody: after.value?.version === 1, duplicatePreservedEtag: after.etag === first.etag }));
    assert.deepEqual(after.value, { version: 1 });
    const condition = etag => format === 'quoted' ? `"${etag.replace(/^"|"$/g, '')}"` : format === 'unquoted' ? etag.replace(/^"|"$/g, '') : etag;
    step = `${format}:matching-update`;
    try {
      await storage.writeJson(key, { version: 2 }, { ifMatch: condition(after.etag) });
    } catch (error) {
      if (!(error instanceof StorageConflictError)) throw error;
      console.log(JSON.stringify({ format, matchingUpdateRejected: true }));
      continue;
    }
    assert.deepEqual(await storage.readJson(key, null), { version: 2 });
    step = `${format}:stale-update`;
    await assert.rejects(storage.writeJson(key, { version: 999 }, { ifMatch: condition(after.etag) }), StorageConflictError);
    const fresh = await storage.readJsonWithMeta(key, null);
    assert.deepEqual(fresh.value, { version: 2 });
    step = `${format}:concurrent-update`;
    const race = await Promise.allSettled([3, 4].map(version => storage.writeJson(key, { version }, { ifMatch: condition(fresh.etag) })));
    const wins = race.filter(r => r.status === 'fulfilled').length;
    const conflicts = race.filter(r => r.status === 'rejected' && r.reason instanceof StorageConflictError).length;
    console.log(JSON.stringify({ format, matchingUpdateAccepted: true, concurrentWinners: wins, concurrentConflicts: conflicts }));
    assert.equal(wins, 1); assert.equal(conflicts, 1);
  }
  console.log('Diagnostic finished; this is NOT a migration readiness approval. Synthetic objects retained.');
} catch (error) {
  console.error(`Diagnostic failed at ${step}: ${error?.name || 'Error'}`);
  process.exitCode = 1;
}
