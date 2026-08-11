import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { calculateOfferFromBusinessConfig } from "../apps/web/lib/catalog/market-business-calculation";
import { catalogPowerDisplay } from "../apps/web/lib/catalog/presentation";
import { resolveCatalogMarketConfig } from "../apps/web/lib/catalog/estimated-market-config";

const customsPricing = fs.readFileSync("apps/web/lib/catalog/customs-pricing.ts", "utf8");
const catalogCard = fs.readFileSync("apps/web/components/catalog/CatalogCard.tsx", "utf8");
const carsPage = fs.readFileSync("apps/web/app/(public)/cars/page.tsx", "utf8");

const markets = ["japan", "china", "korea", "uae", "europe", "georgia", "kyrgyzstan"];

test("fills the full customer cost structure for every market when saved fields are null", () => {
  for (const market of markets) {
    const resolved = resolveCatalogMarketConfig(market, {
      market,
      status: "draft",
      securityDepositRub: null,
      commissionRub: null,
      deliveryToVladivostokRub: null,
      inlandLogisticsRub: null,
      brokerRub: null,
      certificationRub: null,
      eptsRub: null,
      svhRub: null,
      miscRub: null,
      customsClearanceRub: null,
    } as any);
    const calculation = calculateOfferFromBusinessConfig({
      market,
      marketConfig: resolved.config,
      sourcePriceRub: 1_000_000,
      customsRub: 500_000,
    });
    assert.ok(calculation.totalRub > 1_500_000, market);
    assert.ok(calculation.breakdown.some((line) => line.id === "car" && line.amountRub === 1_000_000), market);
    assert.ok(calculation.breakdown.some((line) => line.id === "customs" && line.amountRub === 500_000), market);
    assert.ok(calculation.breakdown.some((line) => line.id === "topavto-commission" && line.amountRub > 0), market);
    assert.ok(resolved.estimatedFields.length > 0, market);
  }
});

test("keeps the Japan contract payment at 70,000 rubles", () => {
  const resolved = resolveCatalogMarketConfig("japan", {
    market: "japan",
    status: "draft",
    securityDepositRub: null,
    commissionRub: null,
  } as any);
  const calculation = calculateOfferFromBusinessConfig({
    market: "japan",
    marketConfig: resolved.config,
    sourcePriceRub: 1_000_000,
    customsRub: 500_000,
  });
  const contractPayment = calculation.breakdown
    .filter((line) => line.id === "security-deposit" || line.id === "topavto-commission")
    .reduce((sum, line) => sum + line.amountRub, 0);
  assert.equal(contractPayment, 70_000);
});

test("does not present an unverified hybrid preview as certified 30-minute power", () => {
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
});

test("converts source prices to rubles before power and utilization checks", () => {
  const rateAt = customsPricing.indexOf("const rate = await convertToRub(offer.sourcePrice, offer.sourceCurrency)");
  const utilizationAt = customsPricing.indexOf("const utilizationProblem = exactUtilizationPowerProblem(offer)");
  const powerAt = customsPricing.indexOf("if (!electrified && !positive(offer.powerHp)");
  assert.ok(rateAt >= 0 && utilizationAt > rateAt && powerAt > rateAt);
  assert.match(customsPricing, /currencyRate: rate/);
  assert.match(customsPricing, /sourcePriceRub: rate\.sourcePriceRub/);
});

test("catalog cards preserve the compact layout and never render source currency", () => {
  assert.match(catalogCard, /catalogOfferVisibleRub/);
  assert.match(catalogCard, /const visibleRub = catalogOfferVisibleRub\(normalizedOffer\)/);
  assert.match(catalogCard, /totalRub: visibleRub \|\| null/);
  assert.match(catalogCard, /<CatalogPrice offer=\{displayOffer\} label=\{priceLabel\}/);
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
});
