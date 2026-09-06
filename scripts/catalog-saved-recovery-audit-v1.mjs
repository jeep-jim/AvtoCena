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
const internalAllowed = new Set();
const sourceMarkets = new Map();
async function read(key) {
  if (!internalAllowed.has(key) && key !== 'catalog/manifest.json' && !/^catalog\/generations\/[^/]+\/offers\/(korea|china|uae|europe|georgia)\/[^/]+\.json$/.test(key)) throw new Error('saved_audit_invalid_key');
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
const report = { version: 1, phase: 'saved_evidence_inspection', checkedAt: new Date().toISOString(), commit: process.env.GITHUB_SHA || null, productionWrites: false, publishAllowedMutations: false, sourceRequests: 0, japanRequests: 0, generationId: manifest.generationId, generationUpdatedAt: manifest.updatedAt, markets: {}, failures: [], reads, limits: { maxHttpRequests: 1500, concurrency: 1, samplePerMarket: 8 }, limitation: 'Saved evidence only. No fresh source availability check and no independent verification of all customs formula results; legacy displayed totals are not automatically confirmed.' };
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
        sourceMarkets.set(offer.sourceId, market);
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
  // Read only source IDs observed in the non-Japan public chunks, one declared
  // internal chunk per source. Never list the bucket or read Japanese archives.
  internalAllowed.add('catalog/internal/manifest.json');
  const internal = await read('catalog/internal/manifest.json');
  report.internalEvidence = {};
  function boundedFields(value, prefix = '', depth = 0, result = {}) {
    if (!value || typeof value !== 'object' || depth > 4) return result;
    for (const [key, item] of Object.entries(value).slice(0, 100)) {
      if (Object.keys(result).length >= 100 || /vin|frame|phone|email|address|contact|html|description/i.test(key)) continue;
      const field = prefix ? `${prefix}.${key}` : key;
      if (item && typeof item === 'object') boundedFields(item, field, depth + 1, result);
      else if (/engine|fuel|power|displac|year|capacity|model|make|brand|hrspow|engdis|spec|variant|confidence|detailIdentity|photoIdentity|listingBound/i.test(field)
        && ['string', 'number', 'boolean'].includes(typeof item) && String(item).length <= 160 && !/[<>]/.test(String(item))) result[field] = item;
    }
    return result;
  }
  for (const [sourceId, market] of sourceMarkets) {
    if (!/^[a-z0-9_-]+$/.test(sourceId) || /japan|jpauc|prestige|jpcenter/.test(sourceId)) throw new Error('internal_source_scope_invalid');
    const entry = internal.sources?.[sourceId];
    if (!entry?.chunks?.length) { report.internalEvidence[sourceId] = { market, available: false }; continue; }
    const key = entry.chunks[0];
    if (!String(key).startsWith(`catalog/internal/offers/${sourceId}/`) || !String(key).endsWith('.json')) throw new Error('internal_chunk_scope_invalid');
    internalAllowed.add(key);
    const rows = await read(key);
    if (!Array.isArray(rows) || rows.some(x => x.market !== market || x.sourceId !== sourceId)) throw new Error('internal_rows_scope_invalid');
    report.internalEvidence[sourceId] = { market, available: true, totalCount: entry.count, sampledRows: rows.length,
      samples: rows.slice(0, 2).map(x => ({ id: x.id, make: x.make, model: x.model, year: x.year,
        operationalKeys: Object.keys(x.operational || {}).slice(0, 60), rawKeys: Object.keys(x.operational?.raw || {}).slice(0, 60),
        fields: boundedFields(x.operational) })) };
  }
  const internalAfter = await read('catalog/internal/manifest.json');
  if (JSON.stringify(internalAfter) !== JSON.stringify(internal)) report.failures.push('internal_manifest_changed_during_audit');
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
