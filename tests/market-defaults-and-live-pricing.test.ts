import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { resolveEffectiveMarketVersion } from "../apps/web/lib/effective-market-settings";
import { applyActiveBusinessPricing, repriceOfferWithBusinessConfig } from "../apps/web/lib/catalog/live-business-pricing";

const markets = JSON.parse(fs.readFileSync(new URL("../data/markets/markets.json", import.meta.url), "utf8"));
const expectedMarkets = ["japan", "china", "korea", "uae", "europe", "georgia", "kyrgyzstan"];
const requiredAmounts = [
  "securityDepositRub", "topAvtoCommissionRub", "contractInitialPaymentRub",
  "exportExpensesRub", "logisticsRub", "brokerRub", "svhRub", "laboratoryRub",
  "sbktsRub", "eptsRub", "rfDeliveryRub", "otherFixedExpensesRub", "exchangeRateReservePercent",
];

test("all seven markets have an active filled default profile in CRM data", () => {
  assert.deepEqual(markets.map((market: any) => market.id).sort(), [...expectedMarkets].sort());
  for (const market of markets) {
    const version = market.versions.find((row: any) => row.id === market.activeVersionId);
    assert.ok(version, `${market.id}: active version missing`);
    assert.equal(version.status, "active", `${market.id}: profile is not active`);
    assert.equal(version.active, true, `${market.id}: active flag is false`);
    assert.ok(version.currency, `${market.id}: currency missing`);
    for (const field of requiredAmounts) {
      assert.ok(Number.isFinite(Number(version[field])) && Number(version[field]) >= 0, `${market.id}: ${field} missing`);
    }
    assert.ok(
      Number(version.contractInitialPaymentRub) >= Number(version.securityDepositRub) + Number(version.topAvtoCommissionRub),
      `${market.id}: initial payment is below deposit plus commission`,
    );
  }
});

test("a legacy draft becomes a usable provisional profile without overwriting entered values", () => {
  const resolved = resolveEffectiveMarketVersion("korea", {
    id: "old-draft",
    version: 1,
    status: "draft",
    active: false,
    currency: "KRW",
    topAvtoCommissionRub: 95_000,
    securityDepositRub: null,
  });
  assert.equal(resolved.status, "active");
  assert.equal(resolved.active, true);
  assert.equal(resolved.topAvtoCommissionRub, 95_000);
  assert.equal(resolved.securityDepositRub, 110_000);
  assert.equal(resolved.provisional, true);
});

test("a complete confirmed CRM profile keeps its own values", () => {
  const current = {
    id: "confirmed",
    version: 8,
    status: "active",
    active: true,
    currency: "EUR",
    provisional: false,
    securityDepositRub: 50_000,
    topAvtoCommissionRub: 77_000,
    contractInitialPaymentRub: 127_000,
    exchangeRateReservePercent: 1,
    exportExpensesRub: 10_000,
    logisticsRub: 20_000,
    brokerRub: 30_000,
    svhRub: 40_000,
    laboratoryRub: 50_000,
    sbktsRub: 60_000,
    eptsRub: 70_000,
    rfDeliveryRub: 80_000,
    otherFixedExpensesRub: 90_000,
  };
  const resolved = resolveEffectiveMarketVersion("europe", current);
  assert.equal(resolved.id, "confirmed");
  assert.equal(resolved.logisticsRub, 20_000);
  assert.equal(resolved.provisional, false);
});

test("visible offer is repriced from current CRM values without changing customs snapshot", () => {
  const offer = {
    id: "china-1",
    market: "china",
    priceMode: "fixed",
    calculationStatus: "ready",
    totalRub: 1_900_000,
    calculationSnapshot: {
      currencyRate: { sourcePriceRub: 1_000_000, effectiveRate: 12.5 },
      customs: { status: "ready", totalCustomsRub: 500_000 },
      customsValue: { vehiclePriceRub: 1_000_000, totalRub: 1_000_000 },
      warnings: [],
    },
  } as any;
  const config = markets.find((market: any) => market.id === "china").versions[0];
  const result = repriceOfferWithBusinessConfig(offer, config);

  assert.equal(result.totalRub, 2_215_000);
  assert.equal(result.previousTotalRub, 1_900_000);
  assert.equal(result.priceDeltaRub, 315_000);
  assert.equal(result.calculationSnapshot.customs.totalCustomsRub, 500_000);
  assert.equal(result.calculationSnapshot.businessConfigVersion, "market_china_v2");
  assert.equal(result.calculationSnapshot.provisionalMarketConfig, true);
  assert.equal(result.priceMode, "estimated");
  const deposit = result.calculationSnapshot.breakdown.find((line: any) => line.id === "security-deposit");
  const car = result.calculationSnapshot.breakdown.find((line: any) => line.id === "car");
  assert.equal(Number(deposit.amountRub) + Number(car.amountRub), 1_000_000);
});

test("completed Japanese auction keeps its historical published total", () => {
  const offer = {
    id: "japan-sold-1",
    market: "japan",
    priceMode: "fixed",
    totalRub: 2_678_898,
    previousTotalRub: 2_500_000,
    priceDeltaRub: 178_898,
    calculationSnapshot: {
      currencyRate: { sourcePriceRub: 1_010_327, effectiveRate: 0.54 },
      customs: { status: "ready", totalCustomsRub: 700_000 },
    },
  } as any;
  const config = markets.find((market: any) => market.id === "japan").versions[0];
  const result = repriceOfferWithBusinessConfig(offer, config);
  assert.equal(result.totalRub, 2_678_898);
  assert.equal(result.previousTotalRub, null);
  assert.equal(result.priceDeltaRub, null);
});

test("pending public offer gets a ruble source-price snapshot even before customs is ready", async () => {
  const result = await applyActiveBusinessPricing({
    id: "pending-rub",
    market: "georgia",
    sourcePrice: 1_750_000,
    sourceCurrency: "RUB",
    calculationStatus: "needs_power_data",
    totalRub: null,
    calculationSnapshot: {},
  } as any);

  assert.equal(result.totalRub, null);
  assert.equal(result.calculationStatus, "needs_power_data");
  assert.equal(result.calculationSnapshot?.currencyRate?.sourcePriceRub, 1_750_000);
  assert.equal(result.calculationSnapshot?.sourcePriceRub, 1_750_000);
});

test("CRM calculation preview uses the same production engines instead of copied tariff formulas", () => {
  const preview = fs.readFileSync(new URL("../apps/web/components/crm/settings/CalculationEnginePreview.tsx", import.meta.url), "utf8");
  const page = fs.readFileSync(new URL("../apps/web/app/(crm)/crm/settings/page.tsx", import.meta.url), "utf8");

  assert.match(preview, /calculateRussiaCustomsForIndividual/);
  assert.match(preview, /utilizationPowerKwForInput/);
  assert.match(preview, /calculateAvtocenaFromBusinessConfig/);
  assert.match(preview, /convertToRub/);
  assert.match(preview, /isOfficialCustomsCurrencyRate/);
  assert.doesNotMatch(preview, /131\.04/);
  assert.match(page, /CalculationEnginePreview/);
});
