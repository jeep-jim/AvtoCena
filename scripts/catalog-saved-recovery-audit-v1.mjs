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
let currencyRequestCount = 0;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const method = init.method || (input instanceof Request ? input.method : 'GET');
  if (method === 'GET' && url.href === 'https://www.cbr.ru/scripts/XML_daily.asp' && currencyRequestCount === 0) {
    currencyRequestCount++; requestCount++;
    return originalFetch(input, { ...init, redirect: 'error' });
  }
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
const publicRows = new Map();
const recoveredRows = [];
const recoveredIds = new Set();
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
const report = { version: 1, phase: 'saved_recovery_dry_run', checkedAt: new Date().toISOString(), commit: process.env.GITHUB_SHA || null, productionWrites: false, publishAllowedMutations: false, sourceRequests: 0, japanRequests: 0, generationId: manifest.generationId, generationUpdatedAt: manifest.updatedAt, markets: {}, failures: [], reads, limits: { maxHttpRequests: 1500, concurrency: 1, samplePerMarket: 8 }, limitation: 'Saved evidence only. No fresh source availability check and no independent verification of all customs formula results; legacy displayed totals are not automatically confirmed.' };
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
        publicRows.set(offer.id, offer);
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
  // Read only source IDs observed in the non-Japan public chunks and their
  // manifest-declared internal chunks. Never list the bucket or read Japanese archives.
  internalAllowed.add('catalog/internal/manifest.json');
  const internal = await read('catalog/internal/manifest.json');
  report.internalEvidence = {};
  const { getJsonStorage } = await import('../apps/web/lib/data.ts');
  const { restoreSavedSourceEvidence } = await import('../apps/web/lib/catalog/saved-source-recovery.ts');
  const { specificationEvidenceComplete } = await import('../apps/web/lib/catalog/modification-matching.ts');
  const { prepareModificationRecovery } = await import('../apps/web/lib/catalog/modification-recovery.ts');
  const { calculateOfferWithVerifiedSpecifications } = await import('../apps/web/lib/catalog/customs-pricing.ts');
  const { limitModificationInventory } = await import('../apps/web/lib/catalog/modification-contract.ts');
  const { previewCanonicalPublicCatalogOffers } = await import('../apps/web/lib/catalog/storage.ts');
  const cachedPricing = new Map();
  for (const key of ['fees/exchange-rates.json', 'markets/markets.json']) {
    internalAllowed.add(key); cachedPricing.set(key, await read(key));
  }
  // One documented official XML request refreshes only the in-memory snapshot.
  // The Object Storage currency cache remains unchanged.
  report.currencyEvidence = { url: 'https://www.cbr.ru/scripts/XML_daily.asp', documentation: 'https://www.cbr.ru/development/sxml/' };
  try {
    const response = await fetch(report.currencyEvidence.url, { method: 'GET', signal: AbortSignal.timeout(20000) });
    const bytes = new Uint8Array(await response.arrayBuffer());
    Object.assign(report.currencyEvidence, { status: response.status, finalUrl: response.url,
      contentType: response.headers.get('content-type'), bytes: bytes.length, bodyHash: crypto.createHash('sha256').update(bytes).digest('hex') });
    if (!response.ok || bytes.length > 250000) throw new Error('official_currency_response_invalid');
    const xml = new TextDecoder().decode(bytes);
    const date = xml.match(/<ValCurs[^>]*Date=["'](\d{2})\.(\d{2})\.(\d{4})["']/i);
    if (!date) throw new Error('official_currency_date_missing');
    const rateDate = `${date[3]}-${date[2]}-${date[1]}`;
    const age = Date.now() - Date.parse(rateDate);
    if (!Number.isFinite(age) || age > 4 * 86400000 || age < -86400000) throw new Error('official_currency_date_not_fresh');
    const rates = [];
    for (const match of xml.matchAll(/<Valute\b[^>]*>([\s\S]*?)<\/Valute>/gi)) {
      const value = tag => match[1].match(new RegExp(`<${tag}>([^<]+)</${tag}>`, 'i'))?.[1]?.trim();
      const currency = value('CharCode');
      if (!['EUR','USD','CNY','KRW','AED','GEL'].includes(currency)) continue;
      const nominal = Number(value('Nominal')), cbrRate = Number(String(value('Value')).replace(',', '.'));
      if (!(nominal > 0) || !(cbrRate > 0)) throw new Error('official_currency_value_invalid');
      rates.push({ currency, nominal, cbrRate, effectiveRate: cbrRate / nominal, rateDate, rateSource: 'cbr', fetchedAt: new Date().toISOString() });
    }
    if (!rates.some(x => x.currency === 'EUR')) throw new Error('official_eur_rate_missing');
    cachedPricing.set('fees/exchange-rates.json', { updatedAt: new Date().toISOString(), rates });
    Object.assign(report.currencyEvidence, { rateDate, currencies: rates.map(x => x.currency), fresh: true });
  } catch (error) { report.currencyEvidence.fresh = false; report.currencyEvidence.error = String(error.message || error).slice(0, 160); }
  // Every calculation uses the same captured settings; repeated cache lookups
  // generate no requests. No fallback to a marketplace or live currency endpoint.
  const calculationStorage = getJsonStorage();
  const underlyingRead = calculationStorage.readJsonWithMeta.bind(calculationStorage);
  calculationStorage.readJsonWithMeta = async (key, fallback) => cachedPricing.has(key)
    ? { found: true, value: cachedPricing.get(key) } : underlyingRead(key, fallback);
  report.pricingSnapshot = { ratesUpdatedAt: cachedPricing.get('fees/exchange-rates.json').updatedAt, liveRatesRequested: currencyRequestCount > 0 };
  report.unrestoredBindingSamples = {};
  report.recovery = Object.fromEntries(MARKETS.map(market => [market, { matchedSavedRows: 0, sourceEvidenceRestored: 0,
    specificationComplete: 0, recalculated: 0, automaticBeforeDedup: 0, selectorBeforeDedup: 0,
    missingInternal: 0, changedFuel: 0, changedEngineCc: 0, changedPowerHp: 0, blockers: {}, examples: [] }]));
  async function recover(saved) {
    const published = publicRows.get(saved.id);
    if (!published || recoveredIds.has(saved.id)) return;
    const summary = report.recovery[saved.market];
    summary.matchedSavedRows++;
    recoveredIds.add(saved.id);
    if (saved.sourceId !== published.sourceId || saved.sourceOfferId !== published.sourceOfferId
      || saved.year !== published.year || saved.sourcePrice !== published.sourcePrice || saved.sourceCurrency !== published.sourceCurrency) {
      inc(summary.blockers, 'saved_public_source_identity_or_price_mismatch'); return;
    }
    const joined = { ...published, operational: saved.operational };
    let restored = restoreSavedSourceEvidence(joined);
    if (restored.operational?.savedSourceRecovery) summary.sourceEvidenceRestored++;
    else {
      const samples = report.unrestoredBindingSamples[saved.sourceId] ||= [];
      const op = saved.operational || {}, raw = op.raw || {};
      if (samples.length < 2) samples.push({ id: saved.id, sourceOfferId: saved.sourceOfferId,
        parsedId: raw.parsed?.id, listingSpecId: raw.listing?.specId, configSpecId: raw.configSpecId,
        detailInfoId: raw.detail?.infoid, listingInfoId: raw.listing?.infoid,
        exactDetail: op.exactDetail, detailIdentityVerified: raw.detailIdentityVerified,
        fieldIdentityVerified: op.fieldIdentityVerified, sourceExactFields: op.sourceExactFields,
        parsedEngine: raw.parsed?.engineCc, parsedFuel: raw.parsed?.fuel, parsedPower: raw.parsed?.powerHp });
    }
    if (restored.fuel !== published.fuel) summary.changedFuel++;
    if (restored.engineCc !== published.engineCc) summary.changedEngineCc++;
    if (restored.powerHp !== published.powerHp) summary.changedPowerHp++;
    if (specificationEvidenceComplete(restored)) {
      summary.specificationComplete++;
      restored = await calculateOfferWithVerifiedSpecifications(restored);
      if (catalogOfferVisibleRub(restored) > 0) summary.recalculated++;
    }
    const prepared = await prepareModificationRecovery(restored);
    const qualification = prepared.recoveryQualification;
    if (qualification.status === 'automatic') summary.automaticBeforeDedup++;
    else if (qualification.status === 'selection_required') summary.selectorBeforeDedup++;
    else for (const reason of qualification.reasons.length ? qualification.reasons : ['listing_identity_photo_price_or_calculation_gate']) inc(summary.blockers, reason);
    if (qualification.status !== 'blocked') recoveredRows.push(prepared);
    if (summary.examples.length < 4) summary.examples.push({ id: published.id, make: published.make, model: published.model,
      status: qualification.status, previous: { fuel: published.fuel, engineCc: published.engineCc, powerHp: published.powerHp },
      recovered: { fuel: prepared.fuel, engineCc: prepared.engineCc, powerHp: prepared.powerHp }, reasons: qualification.reasons });
  }

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
    let sourceRowsRead = 0;
    for (const key of entry.chunks) {
    if (!String(key).startsWith(`catalog/internal/offers/${sourceId}/`) || !String(key).endsWith('.json')) throw new Error('internal_chunk_scope_invalid');
    internalAllowed.add(key);
    const rows = await read(key);
    if (!Array.isArray(rows) || rows.some(x => x.market !== market || x.sourceId !== sourceId)) throw new Error('internal_rows_scope_invalid');
    sourceRowsRead += rows.length;
    for (const row of rows) await recover(row);
    if (!report.internalEvidence[sourceId]) report.internalEvidence[sourceId] = { market, available: true, totalCount: entry.count, sampledRows: rows.length,
      samples: rows.slice(0, 2).map(x => ({ id: x.id, make: x.make, model: x.model, year: x.year,
        operationalKeys: Object.keys(x.operational || {}).slice(0, 60), rawKeys: Object.keys(x.operational?.raw || {}).slice(0, 60),
        fields: boundedFields(x.operational) })) };
  }
      if (sourceRowsRead !== entry.count) report.failures.push(`${sourceId}:internal_count_mismatch`);
      report.internalEvidence[sourceId].readRows = sourceRowsRead;
    }
  for (const row of publicRows.values()) if (!recoveredIds.has(row.id)) report.recovery[row.market].missingInternal++;
  const canonical = await previewCanonicalPublicCatalogOffers(recoveredRows);
  const accepted = limitModificationInventory(canonical.offers, catalogOfferVisibleRub);
  for (const market of MARKETS) {
    const rows = accepted.filter(x => x.market === market);
    const automatic = rows.filter(x => x.recoveryQualification.status === 'automatic' && catalogOfferVisibleRub(x) > 0).length;
    Object.assign(report.recovery[market], { accepted: rows.length, automaticAccepted: automatic,
      selectorAccepted: rows.length - automatic, automaticShare: rows.length ? automatic / rows.length : null });
  }
  report.recoveryTotals = { input: publicRows.size, accepted: accepted.length,
    automatic: accepted.filter(x => x.recoveryQualification.status === 'automatic').length,
    selectors: accepted.filter(x => x.recoveryQualification.status === 'selection_required').length,
    duplicatesRemoved: canonical.deduplicated.removed.length, identityRejected: canonical.identityRejected.length,
    qualityRejected: canonical.qualityRejected.length, priceOutliers: canonical.priceOutliers.length,
    modelQuotaRemoved: canonical.quota.removed.length, selectorQuotaRemoved: canonical.offers.length - accepted.length,
    publishAllowed: false, productionReleaseReady: false };
  report.recoveryTotals.automaticShare = accepted.length ? report.recoveryTotals.automatic / accepted.length : null;
  console.log(JSON.stringify({ recovery: report.recovery, totals: report.recoveryTotals }));
  calculationStorage.readJsonWithMeta = underlyingRead;
  const internalAfter = await read('catalog/internal/manifest.json');
  if (JSON.stringify(internalAfter) !== JSON.stringify(internal)) report.failures.push('internal_manifest_changed_during_audit');
  const after = await read('catalog/manifest.json');
  if (JSON.stringify(after) !== JSON.stringify(manifest)) report.failures.push('manifest_changed_during_audit');
} catch (error) {
  report.failures.push(String(error.message || error).replace(/https?:\/\/\S+/g, '[url]').slice(0, 500));
} finally {
  report.requestCount = requestCount;
  report.deniedRequests = deniedRequests;
  report.currencyRequestCount = currencyRequestCount;
  report.complete = report.failures.length === 0 && deniedRequests === 0;
  await fs.writeFile(OUTPUT, JSON.stringify(report, null, 2) + '\n');
  globalThis.fetch = originalFetch;
}
if (!report.complete) process.exitCode = 1;
