import fs from 'node:fs/promises';
process.env.JSON_STORAGE_DRIVER = 'local';
process.env.CATALOG_IMAGE_STORAGE_MODE = 'source_urls_only';
const originalFetch = globalThis.fetch;
let rateRequests = 0;
globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  if (url.href !== 'https://www.cbr.ru/scripts/XML_daily.asp' || (init.method || 'GET') !== 'GET' || rateRequests++) throw new Error('replay_network_outside_envelope');
  return originalFetch(url, { redirect: 'error', signal: AbortSignal.timeout(15000) });
};
const { getJsonStorage } = await import('../apps/web/lib/data.ts');
const storage = getJsonStorage();
for (const method of ['writeJson', 'writeJsonIfMatch', 'deleteObject', 'deleteObjects', 'deletePrefix', 'putBinary']) storage[method] = async () => { throw new Error('replay_storage_write_blocked'); };
const { porscheFinderDetail } = await import('../apps/web/lib/catalog/porsche-finder-source.ts');
const { calculateOfferWithVerifiedSpecifications } = await import('../apps/web/lib/catalog/customs-pricing.ts');
const { catalogOfferVisibleRub, catalogPublicPriority } = await import('../apps/web/lib/catalog/public-priority.ts');
const { hasAllowedCatalogSourceProvenance } = await import('../apps/web/lib/catalog/offer-quality.ts');
const fixture = JSON.parse(await fs.readFile('tests/fixtures/porsche-finder-bound-record.json', 'utf8'));
const flight = '1:' + JSON.stringify(fixture.record) + '\n';
const markup = `<script>self.__next_f.push(${JSON.stringify([1, flight])})</script><script type="application/ld+json">${JSON.stringify(fixture.product)}</script>`;
const offer = porscheFinderDetail(markup, fixture.source, 'uae');
if (!offer) throw new Error('bound_record_replay_failed');
const calculated = await calculateOfferWithVerifiedSpecifications(offer);
const sum = (calculated.calculationSnapshot?.breakdown || []).reduce((sum, line) => sum + Number(line.amountRub || 0), 0);
const report = { checkedAt: new Date().toISOString(), productionWrites: false, japanRequests: 0, sourceRequests: 0, rateRequests,
  sourceUrl: fixture.source, sourceOfferId: offer.sourceOfferId, engineCc: offer.engineCc, powerHp: offer.powerHp,
  year: offer.year, productionDate: offer.productionDate || null, imageUrls: offer.images.length,
  sourcePrice: offer.sourcePrice, sourceCurrency: offer.sourceCurrency, calculationStatus: calculated.calculationStatus,
  totalRub: calculated.totalRub, breakdown: calculated.calculationSnapshot?.breakdown, breakdownMatchesTotal: sum === calculated.totalRub,
  currencyRate: calculated.calculationSnapshot?.currencyRate, eurRate: calculated.calculationSnapshot?.eurRate,
  visiblePriceByCalculationContract: catalogOfferVisibleRub(calculated), priority: catalogPublicPriority(calculated),
  sourceAllowedForPublication: hasAllowedCatalogSourceProvenance(calculated),
  limitation: 'Replay of sanitized same-listing data captured 2026-09-07; no source freshness claim, no image body validation. Repository business profile. Experimental source is not enabled in production source registry. Model year and first registration do not prove exact production date.' };
await fs.writeFile('data/catalog/research/porsche-uae-bound-replay-v1-20260907.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
