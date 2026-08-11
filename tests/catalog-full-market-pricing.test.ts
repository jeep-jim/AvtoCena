import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { calculateAvtocenaFromBusinessConfig } from "../packages/engine/src/calculation/calculateAvtocena";
import { resolveCatalogMarketConfig } from "../apps/web/lib/catalog/estimated-market-config";
import { catalogPowerDisplay } from "../apps/web/lib/catalog/power-display";
import type { CatalogMarket } from "../apps/web/lib/catalog/types";

const markets: CatalogMarket[] = ["japan", "china", "korea", "uae", "europe", "georgia", "kyrgyzstan"];
const requiredCosts = ["brokerRub", "svhRub", "laboratoryRub", "sbktsRub", "eptsRub", "rfDeliveryRub"];
const requiredLines = ["car", "topavto-commission", "broker", "svh", "laboratory", "sbkts", "epts", "rf-delivery", "customs"];
const customsPricing = fs.readFileSync(new URL("../apps/web/lib/catalog/customs-pricing.ts", import.meta.url), "utf8");
const catalogCard = fs.readFileSync(new URL("../apps/web/components/catalog/CatalogCard.tsx", import.meta.url), "utf8");
const carsPage = fs.readFileSync(new URL("../apps/web/app/(public)/cars/page.tsx", import.meta.url), "utf8");

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

test("does not expose preview or peak power as 30-minute power", () => {
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
  assert.equal(display, null);

  const exact = catalogPowerDisplay({
    powertrainKind: "other_hybrid",
    fuel: "hybrid",
    power30MinKw: 65,
  });
  assert.ok(exact);
  assert.match(exact?.thirtyMinuteLabel || "", /65/);
  assert.equal(exact?.estimated, false);
});

test("converts source prices to rubles before ordinary-power and utilization decisions", () => {
  const rateAt = customsPricing.indexOf("const rate = await convertToRub(offer.sourcePrice, offer.sourceCurrency)");
  const powerAt = customsPricing.indexOf("if (!electrified && !positive(offer.powerHp))");
  const utilizationAt = customsPricing.indexOf("const utilizationProblem = exactUtilizationPowerProblem(offer)");
  assert.ok(rateAt >= 0, "source conversion must exist");
  assert.ok(powerAt > rateAt, "ordinary power check must happen after ruble conversion");
  assert.ok(utilizationAt > rateAt, "utilization decision must happen after ruble conversion");
  assert.match(customsPricing, /currencyRate: rate/);
  assert.match(customsPricing, /sourcePriceRub: rate\.sourcePriceRub/);
});

test("catalog cards use only public-sanity price and never render source currency", () => {
  assert.match(catalogCard, /catalogOfferVisibleRub/);
  assert.match(catalogCard, /const visibleRub = catalogOfferVisibleRub\(normalizedOffer\)/);
  assert.doesNotMatch(catalogCard, /exactTotalRub\s*\|\|\s*catalogOfferVisibleRub/);
  assert.match(catalogCard, /totalRub: visibleRub \|\| null/);
  assert.match(catalogCard, /<CatalogPrice offer=\{displayOffer\}/);
  assert.match(catalogCard, /const priceLabel = o\.year \? `\$\{o\.year\} г\.` : "Год уточняется"/);
  assert.doesNotMatch(catalogCard, /function sourceMoney/);
  assert.doesNotMatch(catalogCard, /Цена в объявлении/);
  assert.doesNotMatch(catalogCard, /Цена торгов/);
  assert.doesNotMatch(catalogCard, /Расчёт под ключ уточняется/);
  assert.doesNotMatch(catalogCard, /ориентир под ключ/);
});

test("catalog prioritizes Japan sold lots and cars up to 6 million rubles and 160 hp", () => {
  assert.match(carsPage, /PRIORITY_MAX_RUB = 6_000_000/);
  assert.match(carsPage, /PRIORITY_MAX_POWER_HP = 160/);
  assert.match(carsPage, /isJapanAuctionResult\(offer\) \? 5_000/);
  assert.match(carsPage, /\.sort\(businessOrder\)/);
  assert.match(carsPage, /const totalRub = offerRubValue\(offer\)/);
});
