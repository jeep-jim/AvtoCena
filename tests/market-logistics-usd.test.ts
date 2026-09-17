import assert from "node:assert/strict";
import test from "node:test";
import { applyMarketLogisticsUsdRate, MARKET_LOGISTICS_USD } from "../apps/web/lib/catalog/market-logistics";

const now = new Date().toISOString();
const rate = (usd: number) => ({
  currency: "USD",
  cbrRate: 90,
  nominal: 1,
  effectiveRate: 90,
  rateDate: now,
  rateSource: "cbr" as const,
  sourcePrice: usd,
  sourcePriceRub: usd * 90,
});

test("all market logistics tariffs use the owner USD amounts and the official USD rate", () => {
  const expected = { korea: 1200, china: 1500, georgia: 2500, uae: 3000, europe: 4000, japan: 1000 } as const;
  assert.deepEqual(MARKET_LOGISTICS_USD, expected);
  for (const [market, usd] of Object.entries(expected)) {
    const config = applyMarketLogisticsUsdRate(market as keyof typeof expected, { logisticsRub: 1 }, rate(usd));
    assert.equal(config.logisticsRub, usd * 90, market);
    assert.equal(config.logisticsUsd, usd, market);
    assert.equal(config.logisticsRateStatus, "ready", market);
    assert.equal(config.logisticsRateSource, "cbr", market);
  }
});

test("non-official or stale USD rates cannot silently price logistics", () => {
  const fallback = applyMarketLogisticsUsdRate("china", { logisticsRub: 250000 }, { ...rate(1500), rateSource: "fallback_env" });
  assert.equal(fallback.logisticsRateStatus, "unavailable");
  assert.equal(fallback.logisticsRub, 250000);

  const stale = applyMarketLogisticsUsdRate("china", { logisticsRub: 250000 }, {
    ...rate(1500),
    rateDate: "2026-01-01",
  });
  assert.equal(stale.logisticsRateStatus, "unavailable");
});
