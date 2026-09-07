import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { summarizePilotMarket } from './lib/catalog-pilot-summary.mjs';
import { reviewedCatalogImageExclusion, reviewedCatalogGalleryHold } from '../apps/web/lib/catalog/source-gallery-review.ts';

// Reproducible metadata-only checkpoint. No network, storage or workflow writes.
const root = 'data/catalog/research/restart-20260907';
const latest = new Map();
const inputs = [];
const validationPath = 'data/catalog/research/restart-code-validation-v1-20260907.json';
const validationBytes = await fs.readFile(validationPath);
const validation = JSON.parse(validationBytes.toString('utf8'));
inputs.push({ path: validationPath, sha256: crypto.createHash('sha256').update(validationBytes).digest('hex') });
for (const runId of (await fs.readdir(root)).sort((a, b) => Number(a) - Number(b))) {
  for (const name of (await fs.readdir(path.join(root, runId))).sort()) {
    if (!name.endsWith('.json')) continue;
    const file = path.join(root, runId, name);
    const bytes = await fs.readFile(file);
    const report = JSON.parse(bytes.toString('utf8'));
    inputs.push({ path: file, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), codeSha: report.codeSha });
    for (const market of report.markets) {
      if (!market.sourceId) continue;
      const details = market.details || [];
      const summary = summarizePilotMarket(market);
      const priced = details.filter(row => row.totalRub > 0 && !row.error);
      const publicRows = details.filter(row => row.yearAllowed && row.totalRub > 0 && row.totalRub <= 15_000_000
        && row.images >= 5 && row.publicDisplay?.credible && row.publicDisplay.eligible
        && row.publicDisplay.projectionCanRender && row.publicDisplay.pricesAgree && row.publicDisplay.breakdownMatchesTotal);
      const reviewedRows = publicRows.filter(row => !reviewedCatalogGalleryHold({ sourceId: market.sourceId, sourceOfferId: row.sourceOfferId })
        && (row.galleryUrls || []).filter(url => !reviewedCatalogImageExclusion(url)).length >= 5);
      const missing = {};
      for (const row of details) for (const [field, result] of Object.entries(row.fields || {})) {
        if (!['missing', 'ambiguous', 'conflict'].includes(result.state)) continue;
        const key = `${field}:${result.reason}`; missing[key] = (missing[key] || 0) + 1;
      }
      latest.set(market.sourceId, { market: market.market, sourceId: market.sourceId, runId: Number(runId),
        codeSha: report.codeSha, reportPath: file, status: market.status, error: market.error || null,
        sourceRequests: market.requests.length, bridgeUsed: (market.requests || []).some(row => row.origin === 'https://avtocena.com'),
        upstreamBridgeTrafficObserved: false, calculationPreparation: report.calculationPreparation || 'source_evidence_only',
        summary, missingFields: missing, missingSourcePrices: details.filter(row => !row.after?.sourcePrice).length,
        priceParity: { calculated: priced.length, equalCardDetailAndBreakdown: priced.filter(row => row.publicDisplay?.pricesAgree && row.publicDisplay.breakdownMatchesTotal).length },
        reviewReplay: { publicBeforeReview: publicRows.length, publicAfterReview: reviewedRows.length,
          heldOfferIds: publicRows.filter(row => reviewedCatalogGalleryHold({ sourceId: market.sourceId, sourceOfferId: row.sourceOfferId })).map(row => row.sourceOfferId),
          excludedGalleryUrls: [...new Set(details.flatMap(row => row.galleryUrls || []).filter(url => reviewedCatalogImageExclusion(url)))],
          limitation: 'Saved source URL metadata replay, not a new visual review or stored-generation acceptance.' },
        productionInputsUnchanged: report.productionInputsUnchanged === true,
        configurationMismatches: report.configurationMismatches || [], businessSettings: report.businessSettings[market.market],
        clientImageResponses: market.requests.filter(row => /^image\//i.test(row.contentType || '')).length });
    }
  }
}
const sources = [...latest.values()].sort((a, b) => a.market.localeCompare(b.market) || a.sourceId.localeCompare(b.sourceId));
const productionSources = sources.filter(row => !row.sourceId.startsWith('porsche_finder_'));
const report = { version: 1, checkedAt: '2026-09-07', advisoryOnly: true, inputs, validation, sources,
  productionSourceCount: productionSources.length, productionPublication: false, allMarketRestartReady: false,
  imageStorageMode: 'source_urls_only', photoArchiveCreated: false, japanIncluded: false,
  totals: { calculated: productionSources.reduce((sum, row) => sum + row.summary.calculated, 0),
    matchingPrices: productionSources.reduce((sum, row) => sum + row.priceParity.equalCardDetailAndBreakdown, 0),
    publicBeforeReview: productionSources.reduce((sum, row) => sum + row.reviewReplay.publicBeforeReview, 0),
    publicAfterReview: productionSources.reduce((sum, row) => sum + row.reviewReplay.publicAfterReview, 0) },
  limitations: ['Bounded source-order checks, not a full fresh collection or a single comparable acceptance denominator.',
    'Older source-only failures are not evidence that every possible exact Knowledge CORE enrichment failed.',
    'Fixed production bridges expose their JSON result; their upstream request counts are not observed by the runner.',
    'Local preview was blocked by browser policy; full visual and deployed UI acceptance remains open.',
    'Known image exclusions are a small prior-review list, not a general automatic image classifier.'],
  remaining: {
    europe: ['Repeat isolated generation acceptance after reviewed image exclusions and validate displayed galleries; mobile.de and AutoScout24 have fresh exact calculations.'],
    korea: ['Complete exact power evidence for Encar; KCar has fresh exact calculations. Validate gallery diversity and displayed cards.'],
    china: ['Che168 parameters are challenged; Autohome new-car specifications remain ambiguous/incomplete; Guazi reports a source challenge; Dongchedi is a disabled adapter with no live probe.'],
    uae: ['Dubizzle returned a challenge; sampled DubiCars rows have no fixed source price and insufficient exact displacement/power.'],
    georgia: ['MyAuto provides source rows but exact displacement provenance and power remain to be verified; AutoPapa returned 403.'],
    publication: ['Obtain >=80% exact automatic calculations on an accepted deduplicated fresh inventory and qualify every required source.',
      'Complete displayed gallery/list/detail acceptance, deploy the verified runtime, validate an isolated generation and rollback.',
      'Then explicitly activate publication and the weekly five-market schedule with fourteen-day retention; preserve Japan exclusion.'] } };
await fs.writeFile('data/catalog/research/five-market-restart-outcome-v1-20260907.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ sourceCount: productionSources.length, totals: report.totals,
  sources: productionSources.map(row => ({ sourceId: row.sourceId, examined: row.summary.examined,
    calculated: row.summary.calculated, public: row.reviewReplay.publicAfterReview, error: row.error })) }, null, 2));
