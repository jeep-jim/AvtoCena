import fs from 'node:fs/promises';
import crypto from 'node:crypto';

const MARKETS = ['korea', 'china', 'uae', 'europe', 'georgia'];
const OUTPUT = 'catalog-saved-recovery-audit-v1.json';
const registry = JSON.parse(await fs.readFile('data/catalog/source-qualification-v1.json', 'utf8'));
if (registry.productionWrites !== false || registry.publishAllowedMutations !== false || !registry.pausedMarkets.includes('japan') || registry.candidates.some(x => x.publishAllowed !== false)) throw new Error('research_safety_contract_changed');
const allowed = new Set();
const originalFetch = globalThis.fetch;
const endpoint = new URL(process.env.YC_OBJECT_STORAGE_ENDPOINT || 'https://storage.yandexcloud.net');
const bucket = process.env.YC_OBJECT_STORAGE_BUCKET;
const prefix = (process.env.YC_OBJECT_STORAGE_PREFIX || '').replace(/^\/+|\/+$/g, '');
let requestCount = 0;
let deniedRequests = 0;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const method = init.method || (input instanceof Request ? input.method : 'GET');
  if (method !== 'GET' || url.origin !== endpoint.origin || !allowed.has(url.pathname) || url.search || ++requestCount > 1500) {
    deniedRequests++;
    throw new Error('saved_audit_outside_read_only_envelope');
  }
  return originalFetch(input, { ...init, redirect: 'error' });
};
const { ObjectJsonStorage } = await import('../apps/web/lib/data.ts');
const { classifySpecificationEvidence, SPECIFICATION_AUDIT_FIELDS } = await import('../apps/web/lib/catalog/specification-evidence-audit.ts');
const { catalogOfferVisibleRub, catalogRequiredSpecificationRejectionReason } = await import('../apps/web/lib/catalog/public-priority.ts');
const storage = new ObjectJsonStorage();
const reads = [];
async function read(key) {
  if (key !== 'catalog/manifest.json' && !/^catalog\/generations\/[^/]+\/offers\/(korea|china|uae|europe|georgia)\/[^/]+\.json$/.test(key)) throw new Error('saved_audit_invalid_key');
  if (key.split('/').some(x => x === '..' || x === '.')) throw new Error('saved_audit_invalid_key');
  const p = '/' + [bucket, prefix, key].filter(Boolean).join('/').split('/').map(encodeURIComponent).join('/');
  allowed.add(p);
  const result = await storage.readJsonWithMeta(key, null);
  if (!result.found || result.value === null) throw new Error('saved_audit_missing_object');
  reads.push({ key, etag: result.etag || null, bodyHash: crypto.createHash('sha256').update(JSON.stringify(result.value)).digest('hex') });
  return result.value;
}
const inc = (o, k) => { o[k] = (o[k] || 0) + 1; };
const manifest = await read('catalog/manifest.json');
const report = { version: 1, phase: 'baseline', checkedAt: new Date().toISOString(), commit: process.env.GITHUB_SHA || null, productionWrites: false, publishAllowedMutations: false, sourceRequests: 0, japanRequests: 0, generationId: manifest.generationId, generationUpdatedAt: manifest.updatedAt, markets: {}, failures: [], reads, limits: { maxHttpRequests: 1500, concurrency: 1, samplePerMarket: 8 }, limitation: 'Saved evidence only. No fresh source availability check and no independent verification of all customs formula results; legacy displayed totals are not automatically confirmed.' };
try {
  for (const market of MARKETS) {
    const entry = manifest.markets?.[market];
    const summary = { manifestCount: entry?.count || 0, readRows: 0, uniqueRows: 0, legacyPriced: 0, evidenceComplete: 0, evidenceCompleteAndPriced: 0, expired: 0, states: {}, blockers: {}, samples: [] };
    report.markets[market] = summary;
    const ids = new Set();
    for (const chunk of entry?.chunks || []) {
      const key = String(chunk).startsWith('catalog/') ? chunk : `catalog/generations/${manifest.generationId}/offers/${market}/${chunk}.json`;
      if (!key.includes(`/offers/${market}/`)) throw new Error('saved_audit_cross_market_chunk');
      const rows = await read(key);
      if (!Array.isArray(rows)) throw new Error('saved_audit_invalid_chunk');
      for (const offer of rows) {
        summary.readRows++;
        if (offer.market !== market) throw new Error('saved_audit_cross_market_offer');
        if (ids.has(offer.id)) continue;
        ids.add(offer.id); summary.uniqueRows++;
        const fields = Object.fromEntries(SPECIFICATION_AUDIT_FIELDS.map(f => [f, classifySpecificationEvidence(offer, f)]));
        for (const [field, value] of Object.entries(fields)) inc(summary.states, `${field}:${value.state}:${value.reason}`);
        const complete = Object.values(fields).every(x => ['exact', 'not_applicable'].includes(x.state));
        const priced = catalogOfferVisibleRub(offer) > 0;
        if (priced) summary.legacyPriced++;
        if (complete) summary.evidenceComplete++;
        if (complete && priced) summary.evidenceCompleteAndPriced++;
        if (offer.expiresAt && Date.parse(offer.expiresAt) < Date.now()) summary.expired++;
        inc(summary.blockers, catalogRequiredSpecificationRejectionReason(offer) || 'no_existing_specification_blocker');
        if (summary.samples.length < 8 && !complete) summary.samples.push({ id: offer.id, sourceId: offer.sourceId, make: offer.make, model: offer.model, year: offer.year, sourcePrice: offer.sourcePrice, sourceCurrency: offer.sourceCurrency, fuel: offer.fuel, powertrainKind: offer.powertrainKind, engineCc: offer.engineCc, powerHp: offer.powerHp, powerDataSource: offer.powerDataSource, fields });
      }
    }
    if (summary.readRows !== summary.manifestCount) report.failures.push(`${market}:manifest_count_mismatch`);
    console.log(JSON.stringify({ market, readRows: summary.readRows, legacyPriced: summary.legacyPriced, evidenceCompleteAndPriced: summary.evidenceCompleteAndPriced }));
  }
  const after = await read('catalog/manifest.json');
  if (JSON.stringify(after) !== JSON.stringify(manifest)) report.failures.push('manifest_changed_during_audit');
} catch (error) {
  report.failures.push(String(error.message || error).replace(/https?:\/\/\S+/g, '[url]').slice(0, 500));
} finally {
  report.requestCount = requestCount;
  report.deniedRequests = deniedRequests;
  report.complete = report.failures.length === 0 && deniedRequests === 0;
  await fs.writeFile(OUTPUT, JSON.stringify(report, null, 2) + '\n');
  globalThis.fetch = originalFetch;
}
if (!report.complete) process.exitCode = 1;
