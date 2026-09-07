import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveEffectiveMarketVersion } from '../apps/web/lib/effective-market-settings';
import { resolveCatalogMarketConfig, CATALOG_MARKET_DEFAULTS } from '../apps/web/lib/catalog/estimated-market-config';
import { calculateAvtocenaFromBusinessConfig } from '../packages/engine/src/calculation/calculateAvtocena';

test('China CRM logistics override changes only logistics and total in the same pricing engine', () => {
  const configured = { ...CATALOG_MARKET_DEFAULTS.china, id: 'owner_china_v2', version: 2, status: 'active', active: true, logisticsRub: 150_000, contractInitialPaymentRub: 250_000 };
  const original = structuredClone(configured);
  const crm = resolveEffectiveMarketVersion('china', configured);
  const catalog = resolveCatalogMarketConfig('china', configured).config;
  assert.equal(crm.id, configured.id);
  assert.equal(crm.logisticsRub, 150_000);
  assert.equal(catalog.logisticsRub, 150_000);
  const calculate = (marketConfig: any) => calculateAvtocenaFromBusinessConfig({ marketId: 'china', marketConfig, sourcePriceRub: 1_500_000, customsRub: 800_000, utilizationFeeRub: 100_000 });
  const baseline = calculate({ ...catalog, logisticsRub: 250_000 });
  for (const current of [calculate(crm), calculate(catalog)]) {
    assert.equal(current.totalRub - baseline.totalRub, -100_000);
    assert.deepEqual(current.breakdown.filter(row => row.id !== 'logistics'), baseline.breakdown.filter(row => row.id !== 'logistics'));
  }
  assert.deepEqual(configured, original);
});

test('explicit zero costs survive CRM and catalog resolution; missing profiles receive defaults', () => {
  const configured = { logisticsRub: 0, otherFixedExpensesRub: 0, exchangeRateReservePercent: 0 };
  assert.equal(resolveEffectiveMarketVersion('china', configured).logisticsRub, 0);
  assert.equal(resolveCatalogMarketConfig('china', configured).config.logisticsRub, 0);
  assert.equal(resolveEffectiveMarketVersion('korea', null).id, 'market_korea_system_average_v2');
  assert.equal(resolveEffectiveMarketVersion('korea', null).status, 'active');
});
