import fs from 'node:fs/promises';
import path from 'node:path';
import { CATALOG_V2_DEFAULT_POLICY, selectCatalogV2MarketOffers, isCatalogLowPowerOffer } from '../apps/web/lib/catalog/catalog-v2-policy.ts';
import { catalogModelYearQuotaKey } from '../apps/web/lib/catalog/inventory-quota.ts';
import { prepareModificationRecovery } from '../apps/web/lib/catalog/modification-recovery.ts';
process.env.CATALOG_LIVE_RATE_DISABLED = 'true';
process.env.JSON_STORAGE_DRIVER = 'local';
globalThis.fetch = async () => { throw new Error('assortment_audit_offline_only'); };
const root = 'data/catalog/research/five-market-trial-20260907';
const original = JSON.parse(await fs.readFile(path.join(root, 'summary.json'), 'utf8'));
const acceptedIds = new Set(JSON.parse(await fs.readFile(path.join(root, 'accepted-listings.json'), 'utf8')).map(row => row.id));
const output = { version: 1, date: '2026-09-07', productionWrites: false, crmWrites: false,
  scope: 'Offline replay of the existing common trial; not a new crawl or publication.',
  policy: { maxPerModelYearMarket: 20, lowPowerTarget: 0.8, lowPowerGroup: 'combustion_only_at_most_160_hp', minYear: 2020, japanMinYear: 2010, maxTotalRub: 15000000 },
  markets: [], unresolved: [], limitations: ['The 80% share is a selection target when enough valid stock exists; missing low-power supply is reported, never invented.', 'Modification options require trusted applicable evidence; an empty reference set cannot become a fictitious selectable trim.'] };
for (const market of original.markets) {
  const all = [];
  for (const source of market.sources) {
    const directory = path.dirname(source.report);
    for (const filename of (await fs.readdir(directory)).filter(x => /^offers-\d+\.json$/.test(x))) all.push(...JSON.parse(await fs.readFile(path.join(directory, filename), 'utf8')));
  }
  const candidates = all.filter(row => acceptedIds.has(row.id));
  const selection = selectCatalogV2MarketOffers(candidates, { ...CATALOG_V2_DEFAULT_POLICY, maximumPerMarket: 100000 });
  const groups = new Map();
  for (const row of selection.selected) {
    const key = catalogModelYearQuotaKey(row); groups.set(key, (groups.get(key) || 0) + 1);
  }
  if ([...groups.values()].some(x => x > 20)) throw new Error('model_year_cap_violated');
  const manual = { automatic: 0, selection_required: 0, blocked: 0 };
  for (const row of all.filter(row => !acceptedIds.has(row.id))) {
    const prepared = await prepareModificationRecovery(structuredClone(row));
    const status = prepared.recoveryQualification?.status || 'blocked'; manual[status]++;
    output.unresolved.push({ id: row.id, sourceId: row.sourceId, sourceOfferId: row.sourceOfferId, market: row.market,
      make: row.make, model: row.model, year: row.year, status, optionCount: prepared.modificationSelection?.options?.length || 0,
      reasons: prepared.recoveryQualification?.reasons || [],
      missingDescriptionFields: ['bodyType', 'drive', 'transmission', 'engineCc', 'fuel', 'powerHp'].filter(key => !row[key]),
      sourceUrl: row.operational?.sourceUrl });
  }
  output.markets.push({ market: market.market, examined: all.length, acceptedBeforeQuota: candidates.length,
    acceptedAfterQuota: selection.selected.length, removedByQuota: selection.rejected.model_year_quota || 0,
    distinctModels: new Set(selection.selected.map(row => `${row.make}|${row.model}`)).size,
    largestModelYearBucket: Math.max(0, ...groups.values()), lowPowerCombustion: selection.lowPowerCount,
    lowPowerShare: selection.selected.length ? selection.lowPowerCount / selection.selected.length : null,
    missingLowPowerToTarget: Math.max(0, Math.ceil(selection.selected.length * 0.8) - selection.lowPowerCount), manual,
    completeDescriptionCandidates: selection.selected.filter(row => ["bodyType", "drive", "transmission"].every(key => row[key])).length,
    descriptionMissing: Object.fromEntries(['bodyType','drive','transmission'].map(key => [key, selection.selected.filter(row => !row[key]).length])) });
}
await fs.writeFile(path.join(root, 'assortment-audit.json'), JSON.stringify(output, null, 2) + '\n');
console.log(JSON.stringify(output.markets, null, 2));
