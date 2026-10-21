import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { REQUIRED_CATALOG_SOURCES } from '../apps/web/lib/catalog/required-catalog-sources.ts';
import { deduplicatePublicCatalogOffers } from '../apps/web/lib/catalog/public-offer-deduplication.ts';

// One common run, plus two explicit completions of sources that were never
// requested. No older experiments and no best-result selection enter totals.
const root = 'data/catalog/research/five-market-trial-20260907';
const initialRun = '34083757152';
const completionRun = '34084620827';
const completedSources = new Set(['dubizzle_uae_open', 'autopapa_georgia_open']);
const markets = ['korea', 'europe', 'china', 'uae', 'georgia'];
const keys = ['returnedRows', 'duplicateRows', 'uniqueNormalizedRows', 'unexaminedRows', 'examined',
  'allowedYearExamined', 'calculated', 'allowedYearCalculated', 'passingAllFilters', 'detailWorkBlocked'];
const zero = () => Object.fromEntries(keys.map(key => [key, 0]));
const summary = { version: 1, date: '2026-09-07', initialRun, completionRun, productionWrites: false,
  japanIncluded: false, photoStorage: 'source_urls_only', maxOffersPerSource: 200, maxPagesPerSource: 5,
  maxRequestsPerSource: 350, markets: [], totals: zero(), arithmeticFailures: [], intentionallyHiddenPrices: [],
  limitations: [
    'Bounded source-order experiment; not a full-market inventory or an extrapolation of available cars.',
    'Counts identify source listings, not unique physical vehicles across different websites.',
    '86 additional normalized Autohome rows were outside the 200-listing examination cap.',
    'All 255 completed calculations use actual provisional runtime defaults: Korea/Europe have no active production CRM profiles.',
    'Source image URLs were checked structurally; visual gallery acceptance and production publication remain open.',
    'Bridge request counts measure Actions-to-bridge calls; upstream bridge traffic is not visible here.',
    'Initial generic envelope errors on Autohome mean a source stop (used) or the 350-request cap (new); the original reports are preserved.',
  ] };
const accepted = [];
for (const market of markets) {
  const result = { market, counts: zero(), sources: [], provisionalExpenses: false };
  for (const source of REQUIRED_CATALOG_SOURCES[market]) {
    const run = completedSources.has(source.sourceId) ? completionRun : initialRun;
    const directory = path.join(root, run, market, source.sourceId);
    const reportPath = path.join(directory, 'report.json');
    const report = JSON.parse(await fs.readFile(reportPath, 'utf8'));
    assert.equal(report.completed, true);
    assert.equal(report.productionWrites, false);
    assert.equal(report.productionInputsUnchanged, true);
    assert.equal(report.japanRequests, 0);
    assert.deepEqual(report.configurationMismatches, []);
    const row = report.markets.find(row => row.sourceId === source.sourceId);
    assert.ok(row);
    const chunkNames = (await fs.readdir(directory)).filter(name => /^offers-\d+\.json$/.test(name));
    const offers = (await Promise.all(chunkNames.map(async name => {
      const chunk = JSON.parse(await fs.readFile(path.join(directory, name), 'utf8'));
      assert.ok(chunk.length <= 500);
      return chunk;
    }))).flat();
    assert.equal(offers.length, row.summary.examined);
    const byId = new Map(offers.map(offer => [String(offer.sourceOfferId), offer]));
    assert.equal(byId.size, offers.length);
    const missingFields = {};
    let arithmeticChecked = 0;
    for (const offer of offers) for (const image of offer.images || []) {
      assert.ok(/^https?:\/\//.test(image.url));
      assert.equal(image.objectKey, '');
      assert.equal(image.size, 0);
    }
    for (const detail of row.details || []) {
      for (const [field, evidence] of Object.entries(detail.fields || {})) {
        if (!['exact', 'not_applicable'].includes(evidence.state)) {
          const reason = `${field}:${evidence.state}:${evidence.reason}`;
          missingFields[reason] = (missingFields[reason] || 0) + 1;
        }
      }
      if (!['estimated', 'calculated'].includes(detail.calculationStatus) || !(detail.totalRub > 0) || detail.error) continue;
      arithmeticChecked++;
      const offer = byId.get(String(detail.sourceOfferId));
      const display = detail.publicDisplay;
      const breakdown = offer.calculationSnapshot?.breakdown || [];
      const sum = breakdown.reduce((sum, item) => sum + item.amountRub, 0);
      const rate = offer.calculationSnapshot.currencyRate;
      const carRub = breakdown.filter(item => ['car', 'security-deposit'].includes(item.id)).reduce((sum, item) => sum + item.amountRub, 0);
      const priceHidden = display.cardRub === 0 && display.detailRub === 0 && !display.eligible && !display.projectionCanRender;
      if (priceHidden) summary.intentionallyHiddenPrices.push({ sourceId: source.sourceId, sourceOfferId: detail.sourceOfferId, reason: display.reason, totalRub: detail.totalRub });
      if (sum !== offer.totalRub || offer.totalRub !== detail.totalRub || detail.totalRub !== display.totalRub
        || display.cardRub !== display.detailRub || (!priceHidden && display.cardRub !== detail.totalRub)
        || Math.round(rate.sourcePrice * rate.effectiveRate) !== rate.sourcePriceRub || carRub !== rate.sourcePriceRub
        || display.priceDeltaFromCalculationRub !== 0) {
        summary.arithmeticFailures.push({ market, sourceId: source.sourceId, sourceOfferId: detail.sourceOfferId });
      }
      if (detail.yearAllowed && detail.totalRub <= 15_000_000 && detail.images >= 5
        && display.credible && display.eligible && display.projectionCanRender && display.pricesAgree && display.breakdownMatchesTotal) accepted.push(offer);
    }
    assert.equal(arithmeticChecked, row.summary.calculated);
    result.provisionalExpenses = report.businessSettings[market].provisional;
    result.sources.push({ sourceId: source.sourceId, runId: run, codeSha: report.codeSha, report: reportPath,
      status: row.status, error: row.error || null, requestCount: row.requests.length, counts: row.summary,
      arithmeticChecked, missingFields, productionBaseline: report.productionBaseline });
    for (const key of keys) result.counts[key] += row.summary[key];
  }
  for (const key of keys) summary.totals[key] += result.counts[key];
  summary.markets.push(result);
}
const deduplicated = deduplicatePublicCatalogOffers(accepted);
summary.acceptedAfterCardDeduplication = deduplicated.rows.length;
summary.cardDuplicates = deduplicated.removed;
for (const row of summary.markets) row.acceptedAfterCardDeduplication = deduplicated.rows.filter(offer => offer.market === row.market).length;
summary.arithmeticChecked = summary.totals.calculated;
assert.equal(accepted.length, summary.totals.passingAllFilters);
assert.equal(summary.arithmeticFailures.length, 0);
await fs.writeFile(path.join(root, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
await fs.writeFile(path.join(root, 'accepted-listings.json'), JSON.stringify(deduplicated.rows.map(offer => ({
  id: offer.id, sourceId: offer.sourceId, sourceOfferId: offer.sourceOfferId, market: offer.market,
  make: offer.make, model: offer.model, year: offer.year, totalRub: offer.totalRub,
  sourceUrl: offer.operational?.sourceUrl, provisionalExpenses: true,
})), null, 2) + '\n');
console.log(JSON.stringify({ totals: summary.totals, arithmeticChecked: summary.arithmeticChecked,
  arithmeticFailures: summary.arithmeticFailures.length, acceptedAfterCardDeduplication: summary.acceptedAfterCardDeduplication,
  markets: summary.markets.map(row => ({ market: row.market, ...row.counts })) }, null, 2));
