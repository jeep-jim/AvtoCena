import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { PRODUCTION_INPUTS, assertCanaryObjectRequest, assertProductionInputsUnchanged, jsonHash } from './lib/catalog-generation-canary.mjs';

// A fresh crawl and calculation check against actual production CRM/rates.
// Production is read-only, and all image requests/writes are forbidden.
const root = process.cwd();
const output = path.resolve(process.env.PILOT_REPORT || 'five-market-restart-check.json');
const markets = String(process.env.PILOT_MARKETS || 'korea,europe,china,uae,georgia').split(',');
if (!markets.length || markets.some(m => !['korea', 'europe', 'china', 'uae', 'georgia'].includes(m))) throw new Error('restart_check_market_forbidden');
const endpoint = process.env.YC_OBJECT_STORAGE_ENDPOINT || 'https://storage.yandexcloud.net';
const bucket = process.env.YC_OBJECT_STORAGE_BUCKET;
const prefix = (process.env.YC_OBJECT_STORAGE_PREFIX || '').replace(/^\/+|\/+$/g, '');
for (const name of ['YC_OBJECT_STORAGE_BUCKET', 'YC_OBJECT_STORAGE_ACCESS_KEY_ID', 'YC_OBJECT_STORAGE_SECRET_ACCESS_KEY']) {
  if (!process.env[name]) throw new Error(`restart_check_required_setting_missing:${name}`);
}
const originalFetch = globalThis.fetch;
const storageRequests = [];
const guardedFetch = async (input, init = {}) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const method = String(init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
  if (url.origin === new URL(endpoint).origin) {
    if (method !== 'GET') throw new Error('restart_check_storage_write_blocked');
    const key = assertCanaryObjectRequest(url, method, endpoint, bucket, prefix, 'catalog/canaries/unused/');
    if (!PRODUCTION_INPUTS.includes(key)) throw new Error('restart_check_storage_read_blocked');
    storageRequests.push({ key, method });
  }
  return originalFetch(input, init);
};
globalThis.fetch = guardedFetch;
const { ObjectJsonStorage, resetJsonStorageForTests } = await import('../apps/web/lib/data.ts');
const storage = new ObjectJsonStorage();
const readInputs = async () => {
  const values = {};
  for (const key of PRODUCTION_INPUTS) {
    values[key] = await storage.readJsonWithMeta(key, null);
    if (!values[key].found) throw new Error(`restart_check_input_missing:${key}`);
  }
  return values;
};
let temp;
try {
  const before = await readInputs();
  if (!Array.isArray(before['markets/markets.json'].value)) throw new Error('restart_check_invalid_crm');
  temp = await fs.mkdtemp(path.join(os.tmpdir(), 'avtocena-restart-check-'));
  const data = path.join(temp, 'data');
  await fs.mkdir(path.join(data, 'catalog'), { recursive: true });
  for (const entry of await fs.readdir(path.join(root, 'data/catalog'), { withFileTypes: true })) {
    if (['research', 'imports', 'manifest.json', 'generations', 'internal', 'public', 'images', 'image-source-cache', 'canaries', 'japan-auction-history'].includes(entry.name)) continue;
    await fs.symlink(path.join(root, 'data/catalog', entry.name), path.join(data, 'catalog', entry.name));
  }
  for (const key of ['markets/markets.json', 'fees/exchange-rates.json']) {
    await fs.mkdir(path.dirname(path.join(data, key)), { recursive: true });
    await fs.writeFile(path.join(data, key), JSON.stringify(before[key].value));
  }
  process.chdir(temp);
  process.env.JSON_STORAGE_DRIVER = 'local';
  process.env.CATALOG_IMAGE_STORAGE_MODE = 'source_urls_only';
  process.env.PILOT_MARKETS = markets.join(',');
  process.env.PILOT_REPORT = output;
  process.env.PILOT_PUBLIC_DISPLAY_AUDIT = '1';
  process.env.PILOT_QUIET = '1';
  resetJsonStorageForTests();
  const { selectActiveMarketVersion } = await import('../apps/web/lib/business-settings.ts');
  const { resolveEffectiveMarketVersion } = await import('../apps/web/lib/effective-market-settings.ts');
  const businessSettings = Object.fromEntries(markets.map(market => {
    const raw = before['markets/markets.json'].value.find(row => row.id === market);
    const active = selectActiveMarketVersion(raw);
    const effective = resolveEffectiveMarketVersion(market, active);
    return [market, { rawActiveVersion: active?.id || null, effectiveVersion: effective.id,
      profileSource: active ? 'production_crm_version' : 'runtime_average_defaults', provisional: effective.provisional,
      effectiveHash: jsonHash(effective), effectiveExpenses: Object.fromEntries(Object.entries(effective).filter(([key]) => /Rub$|Percent$/.test(key))) }];
  }));
  await import('./catalog-public-detail-calculation-pilot.mjs');
  // The pilot's source guard is deliberately narrower than this read-only
  // production-input guard. Restore it before re-reading the three inputs.
  globalThis.fetch = guardedFetch;
  const after = await readInputs();
  assertProductionInputsUnchanged(before, after);
  const report = JSON.parse(await fs.readFile(output, 'utf8'));
  Object.assign(report, { version: 4, codeSha: process.env.GITHUB_SHA || null,
    businessSettings, productionInputsUnchanged: true, storageRequests,
    productionBaseline: Object.fromEntries(PRODUCTION_INPUTS.map(key => [key, { etag: before[key].etag, sha256: jsonHash(before[key].value) }])),
    limitation: 'Fresh bounded source-order sample against production CRM and rates; missing CRM profiles use the actual provisional runtime default. No publication, image download or storage mutation. Diagnostic alternatives do not become approved catalog sources automatically.' });
  report.configurationMismatches = report.markets.flatMap(row => (row.details || [])
    .filter(item => item.publicDisplay?.totalRub > 0 && item.publicDisplay.businessConfigVersion !== businessSettings[row.market]?.effectiveVersion)
    .map(item => ({ market: row.market, sourceOfferId: item.sourceOfferId, actual: item.publicDisplay.businessConfigVersion, expected: businessSettings[row.market]?.effectiveVersion })));
  await fs.writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ productionInputsUnchanged: true, configurationMismatches: report.configurationMismatches.length,
    markets: report.markets.map(row => ({ market: row.market, sourceId: row.sourceId, summary: row.summary, status: row.status })) }));
  if (report.configurationMismatches.length) process.exitCode = 1;
} finally {
  process.chdir(root);
  globalThis.fetch = originalFetch;
  resetJsonStorageForTests();
  if (temp) await fs.rm(temp, { recursive: true, force: true });
}
