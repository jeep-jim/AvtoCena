import assert from "node:assert/strict";
import test from "node:test";
import { calculateAvtocenaFromBusinessConfig } from "../packages/engine/src/calculation/calculateAvtocena";
import { resolveCatalogMarketConfig } from "../apps/web/lib/catalog/estimated-market-config";
import { catalogPowerDisplay } from "../apps/web/lib/catalog/power-display";
import type { CatalogMarket } from "../apps/web/lib/catalog/types";

const markets: CatalogMarket[] = ["japan", "china", "korea", "uae", "europe", "georgia", "kyrgyzstan"];
const requiredCosts = ["brokerRub", "svhRub", "laboratoryRub", "sbktsRub", "eptsRub", "rfDeliveryRub"];
const requiredLines = ["car", "topavto-commission", "broker", "svh", "laboratory", "sbkts", "epts", "rf-delivery", "customs"];

test("fills the full customer cost structure for every market when saved fields are null", () => {
  for (const market of markets) {
    const configured = {
      id: `market_${market}_v1`,
      version: 1,
      status: market === "japan" ? "active" : "draft",
      active: market === "japan",
      currency: market === "japan" ? "JPY" : undefined,
      securityDepositRub: market === "japan" ? 31_000 : null,
      topAvtoCommissionRub: market === "japan" ? 39_000 : null,
      brokerRub: null,
      svhRub: null,
      laboratoryRub: null,
      sbktsRub: null,
      eptsRub: null,
      rfDeliveryRub: null,
    };
    const resolved = resolveCatalogMarketConfig(market, configured);
    for (const field of requiredCosts) assert.ok(Number(resolved.config[field]) > 0, `${market}:${field}`);

    const calculation = calculateAvtocenaFromBusinessConfig({
      marketId: market,
      marketConfig: resolved.config,
      sourcePriceRub: 1_500_000,
      customsRub: 800_000,
    });
    const lines = new Map(calculation.breakdown.map((line) => [line.id, line]));
    for (const id of requiredLines) assert.ok(Number(lines.get(id)?.amountRub || 0) > 0, `${market}:${id}`);
    assert.equal(lines.get("topavto-commission")?.title, "Комиссия Автодилера");
  }
});

test("keeps the Japan contract payment at 70,000 rubles", () => {
  const resolved = resolveCatalogMarketConfig("japan", {
    id: "market_japan_v1",
    version: 1,
    status: "active",
    active: true,
    currency: "JPY",
    securityDepositRub: 31_000,
    topAvtoCommissionRub: 39_000,
  });
  const calculation = calculateAvtocenaFromBusinessConfig({
    marketId: "japan",
    marketConfig: resolved.config,
    sourcePriceRub: 1_000_000,
    customsRub: 500_000,
  });
  const contractPayment = calculation.breakdown
    .filter((line) => line.id === "security-deposit" || line.id === "topavto-commission")
    .reduce((sum, line) => sum + line.amountRub, 0);
  assert.equal(contractPayment, 70_000);
});

test("shows a calculated 30-minute power chip for a hybrid preview", () => {
  const display = catalogPowerDisplay({
    powertrainKind: "other_hybrid",
    fuel: "hybrid",
    powerHp: 245,
    utilizationPowerKw: 180.2,
    calculationSnapshot: {
      certified30MinutePowerMissing: true,
      utilizationPowerPreviewKw: 180.2,
    },
  });
  assert.ok(display);
  assert.equal(display?.estimated, true);
  assert.equal(display?.thirtyMinuteLabel, "Расчёт: 180,2 кВт");
});
