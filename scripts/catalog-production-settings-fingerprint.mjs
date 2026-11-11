import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { calculateAvtocenaFromBusinessConfig } from '../packages/engine/src/calculation/calculateAvtocena.ts';
import { getJsonStorage } from '../apps/web/lib/data.ts';
import { resolveCatalogMarketConfig } from '../apps/web/lib/catalog/estimated-market-config.ts';
import { selectActiveMarketVersion } from '../apps/web/lib/business-settings.ts';

// Exactly two reads. No catalog, credentials, contacts or setting values in output.
const storage = getJsonStorage();
for (const method of ['writeJson','writeJsonIfMatch','putBinary','deleteObject','deleteObjects','deletePrefix']) {
  storage[method] = async () => { throw new Error('settings_audit_read_only'); };
}
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  return value;
}
const digest = value => crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
const report = { checkedAt: new Date().toISOString(), storageDriver: storage.driver, productionWrites: false, reads: [], markets: [] };
const [marketData, siteData] = await Promise.all([
  storage.readJsonWithMeta('markets/markets.json', null),
  storage.readJsonWithMeta('settings/site-business.json', null),
]);
report.reads = [ ['markets/markets.json',marketData], ['settings/site-business.json',siteData] ].map(([path,result]) => ({ path, found: result.found, hash: result.found ? digest(result.value) : null }));
for (const marketId of ['europe','korea','china','uae','georgia']) {
  const market = (Array.isArray(marketData.value) ? marketData.value : []).find(row => row.id === marketId);
  const active = selectActiveMarketVersion(market);
  const resolved = resolveCatalogMarketConfig(marketId, active);
  const calculationFields = Object.fromEntries(Object.entries(resolved.config).filter(([key]) => /Rub$/.test(key) || ['currency','percentExpenses','exchangeRateReservePercent'].includes(key)));
  report.markets.push({ market: marketId, configVersion: active?.id || null, effectiveFrom: active?.effectiveFrom || null,
    activeHash: active ? digest(active) : null, resolvedCalculationHash: digest(calculationFields), estimatedFields: resolved.estimatedFields,
    calculationFieldHashes: Object.fromEntries(Object.entries(calculationFields).map(([key,value]) => [key,digest(value)])) });
}
report.limitation = 'Resolution uses this branch code and job environment, not attested deployed code or deployment environment overrides.';

report.replayedCalculations = [];
for (const path of ['data/catalog/research/europe-kcar-expanded-pilot-v1-20260906.json', 'data/catalog/research/china-georgia-uae-repaired-pilot-v1-20260906.json']) {
  let pilot; try { pilot = JSON.parse(await fs.readFile(path, 'utf8')); } catch { continue; }
  for (const sample of pilot.markets || []) {
    const market = (Array.isArray(marketData.value) ? marketData.value : []).find(row => row.id === sample.market);
    if (!['europe','korea','china','uae','georgia'].includes(sample.market)) continue;
    const resolved = resolveCatalogMarketConfig(sample.market, selectActiveMarketVersion(market));
    for (const row of sample.details || []) {
      if (!(row.totalRub > 0) || !Array.isArray(row.breakdown)) continue;
      const lineAmount = id => row.breakdown.find(line => line.id === id)?.amountRub || 0;
      const calculated = calculateAvtocenaFromBusinessConfig({ marketId: sample.market, marketConfig: resolved.config,
        sourcePriceRub: lineAmount('car') + lineAmount('security-deposit'), customsRub: lineAmount('customs'), utilizationFeeRub: lineAmount('utilization-fee') });
      report.replayedCalculations.push({ market: sample.market, sourceOfferId: row.sourceOfferId,
        originalTotalRub: row.totalRub, replayedTotalRub: calculated.totalRub, deltaRub: calculated.totalRub - row.totalRub });
    }
  }
}
report.site = { activeVersionId: siteData.value?.activeVersionId || null };
await fs.writeFile(process.env.SETTINGS_FINGERPRINT_OUTPUT || 'settings-fingerprint.json', JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));
if (!marketData.found || !siteData.found) process.exitCode = 2;
