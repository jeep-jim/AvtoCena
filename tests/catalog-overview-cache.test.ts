import assert from 'node:assert/strict';
import test from 'node:test';
import { getJsonStorage } from '../apps/web/lib/data';
import { readCatalogOverview, resetCatalogOverviewCache } from '../apps/web/lib/catalog/overview';

test('overview coalesces concurrent reads, follows generation changes and retries failures', async () => {
  const storage = getJsonStorage(), original = storage.readJsonWithMeta;
  const reads: string[] = [];
  let fail = false;
  storage.readJsonWithMeta = async <T>(key: string) => {
    reads.push(key);
    if (fail) throw Error('temporary storage failure');
    const generationId = key.split('/')[2];
    return {found: true, value: {version: 1, publicPolicyVersion: 2, generationId,
      facets: {generationId}, markets: {}} as T};
  };
  resetCatalogOverviewCache();
  try {
    const results = await Promise.all(Array.from({length: 8}, () => readCatalogOverview('g1')));
    assert.equal(reads.length, 1);
    assert.ok(results.every(result => result?.generationId === 'g1'));
    assert.equal((await readCatalogOverview('g2'))?.generationId, 'g2');
    assert.equal(reads.length, 2);
    fail = true;
    await assert.rejects(readCatalogOverview('g3'), /temporary storage failure/);
    fail = false;
    assert.equal((await readCatalogOverview('g3'))?.generationId, 'g3');
    assert.equal(reads.length, 4);
  } finally {storage.readJsonWithMeta = original; resetCatalogOverviewCache();}
});

test('a stale legacy overview is not accepted or retained as a failed cache entry', async () => {
  const storage = getJsonStorage(), original = storage.readJsonWithMeta;
  let legacyGeneration = 'old';
  storage.readJsonWithMeta = async <T>(key: string, fallback: T) => ({found: true,
    value: key.includes('/generations/') ? fallback : {version: 1, publicPolicyVersion: 2,
      generationId: legacyGeneration, facets: {generationId: legacyGeneration}, markets: {}} as T});
  resetCatalogOverviewCache();
  try {
    assert.equal(await readCatalogOverview('current'), null);
    legacyGeneration = 'current';
    assert.equal((await readCatalogOverview('current'))?.generationId, 'current');
  } finally {storage.readJsonWithMeta = original; resetCatalogOverviewCache();}
});
