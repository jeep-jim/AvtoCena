import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { jsonHash } from '../scripts/lib/catalog-generation-canary.mjs';

test('fresh restart diagnostic copies real CRM inputs, stops at source refusal and never writes production or requests images', async () => {
  const cwd = process.cwd();
  const env = { ...process.env };
  const originalFetch = globalThis.fetch;
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'restart-check-test-'));
  await fs.mkdir(path.join(temp, 'data/catalog'), { recursive: true });
  const inputs: Record<string, unknown> = { 'catalog/manifest.json': { generationId: 'untouched-production' },
    'markets/markets.json': [], 'fees/exchange-rates.json': { RUB: 1 } };
  const requests: Array<{ url: string; method: string }> = [];
  Object.assign(process.env, { YC_OBJECT_STORAGE_ENDPOINT: 'https://storage.example', YC_OBJECT_STORAGE_BUCKET: 'test-bucket',
    YC_OBJECT_STORAGE_PREFIX: 'test', YC_OBJECT_STORAGE_REGION: 'ru-central1', YC_OBJECT_STORAGE_ACCESS_KEY_ID: 'test',
    YC_OBJECT_STORAGE_SECRET_ACCESS_KEY: 'test', PILOT_MARKETS: 'georgia', PILOT_GEORGIA_SOURCE: 'autopapa',
    PILOT_REPORT: path.join(temp, 'report.json'), PILOT_REQUEST_INTERVAL_MS: '0' });
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(String(input));
    const method = String(init.method || 'GET');
    requests.push({ url: url.href, method });
    assert.equal(method, 'GET');
    if (url.origin === 'https://storage.example') {
      const key = decodeURIComponent(url.pathname).replace('/test-bucket/test/', '');
      assert.ok(key in inputs, 'only the three production metadata inputs may be requested');
      return Response.json(inputs[key], { headers: { etag: 'unchanged' } });
    }
    assert.match(url.hostname, /(?:^|\.)autopapa\.ge$/);
    assert.doesNotMatch(url.pathname, /\.(?:jpe?g|webp|png)/);
    return new Response('Access denied', { status: 403 });
  };
  process.chdir(temp);
  try {
    await import('../scripts/catalog-five-market-restart-check.mjs');
    const report = JSON.parse(await fs.readFile(path.join(temp, 'report.json'), 'utf8'));
    assert.equal(report.productionInputsUnchanged, true);
    assert.equal(report.productionBaseline['markets/markets.json'].sha256, jsonHash(inputs['markets/markets.json']));
    assert.equal(report.businessSettings.georgia.profileSource, 'runtime_average_defaults');
    assert.equal(report.storageRequests.length, 6);
    assert.equal(requests.filter(row => !row.url.startsWith('https://storage.example/')).length, 1);
    assert.equal(report.markets.find((row: any) => row.market === 'georgia').stopped, true);
    assert.deepEqual(report.configurationMismatches, []);
    assert.equal(report.imageRequestsBlocked, 0);
    assert.deepEqual(await fs.readdir(path.join(temp, 'data/catalog')), []);
  } finally {
    process.chdir(cwd); globalThis.fetch = originalFetch;
    for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
    Object.assign(process.env, env);
    await fs.rm(temp, { recursive: true, force: true });
  }
});
