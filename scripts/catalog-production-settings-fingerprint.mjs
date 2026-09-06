import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { getJsonStorage } from '../apps/web/lib/data.ts';
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
for (const market of (Array.isArray(marketData.value) ? marketData.value : []).filter(row => ['europe','korea','china','uae','georgia'].includes(row.id))) {
  const active = selectActiveMarketVersion(market);
  report.markets.push({ market: market.id, configVersion: active?.id || null, effectiveFrom: active?.effectiveFrom || null, activeHash: active ? digest(active) : null });
}
report.site = { activeVersionId: siteData.value?.activeVersionId || null };
await fs.writeFile(process.env.SETTINGS_FINGERPRINT_OUTPUT || 'settings-fingerprint.json', JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));
if (!marketData.found || !siteData.found) process.exitCode = 2;
