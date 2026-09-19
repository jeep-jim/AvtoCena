import {activeMarketCosts} from "../packages/engine/src/calculation/market-cost-policy.ts";
import assert from 'node:assert/strict';
import {mutateDataJson, readDataJson} from '../apps/web/lib/data.ts';
import {appendChangeLog, selectActiveMarketVersion} from '../apps/web/lib/business-settings.ts';
import {migrateMarketCosts, MARKET_COSTS_MIGRATION} from '../apps/web/lib/market-costs-migration.ts';

// Only CRM settings and their change log. No catalog/manifest/source access.
const at = new Date().toISOString();
let changes = [];
// Retire the obsolete setting from every saved/scheduled CRM version, idempotently.
const settingsBeforeRetirement = await readDataJson('markets/markets.json', []);
if (settingsBeforeRetirement.some(m => (m.versions || []).some(v => 'exportExpensesRub' in v))) {
  await mutateDataJson('markets/markets.json', [], markets => markets.map(m => ({...m, versions:(m.versions || []).map(activeMarketCosts)})));
  console.log(JSON.stringify({retiredSetting:'exportExpensesRub',markets:settingsBeforeRetirement.map(m=>m.id)}));
}
const existing = await readDataJson('markets/markets.json', []);
if (migrateMarketCosts(existing, at).changed.length) await mutateDataJson('markets/markets.json', [], markets => {
  assert.ok(Array.isArray(markets) && markets.length, 'Existing CRM settings required');
  const result = migrateMarketCosts(markets, at);
  changes = result.changed;
  return result.markets;
});
for (const change of changes) await appendChangeLog({entityType:'market',entityId:change.marketId,
  changedByUserId:'system:owner-request-20260916',changedByName:'По поручению владельца',
  oldValue:change.oldValue,newValue:change.newValue,
  comment:'Единый расход Лаборатория, СБКТС, ЭПТС 50 000 ₽; первый платёж 250 000 ₽ (Japan 70 000 ₽).'});
const settings = await readDataJson('markets/markets.json', []);
const report = settings.map(m => {
  const v = selectActiveMarketVersion(m);
  assert.ok(v?.serviceBundleVersion >= 1, `Unmigrated ${m.id}`);
  return {market:m.id,version:v.id,serviceBundleVersion:v.serviceBundleVersion,
    laboratoryRub:v.laboratoryRub,sbktsRub:v.sbktsRub,eptsRub:v.eptsRub,
    contractInitialPaymentRub:v.contractInitialPaymentRub,commissionRub:v.topAvtoCommissionRub,advanceRub:v.securityDepositRub};
});
console.log(JSON.stringify({migration:MARKET_COSTS_MIGRATION,changed:changes.map(c=>c.marketId),markets:report,ok:true}));
