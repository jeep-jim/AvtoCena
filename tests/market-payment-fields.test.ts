import assert from "node:assert/strict";
import { test } from "node:test";
import { marketPaymentFields } from "../apps/web/lib/market-payment-fields";
import { resolveEffectiveMarketVersion } from "../apps/web/lib/effective-market-settings";
import { calculateAvtocenaFromBusinessConfig } from "../packages/engine/src/calculation/calculateAvtocena";

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

test("each market saves separate amounts and derives the first payment, ignoring a stale submitted total", () => {
  for (const market of ["japan", "china", "korea", "uae", "europe", "georgia"] as const) {
    const japan = market === "japan";
    const original = marketPaymentFields(form({ securityDepositRub: japan ? "31000" : "160000", topAvtoCommissionRub: japan ? "39000" : "90000" }), market);
    assert.equal(original.contractInitialPaymentRub, japan ? 70000 : 250000);
    const changed = marketPaymentFields(form({ securityDepositRub: "42000", topAvtoCommissionRub: "80000", contractInitialPaymentRub: "250000" }), market);
    assert.deepEqual(changed, { securityDepositRub: 42000, topAvtoCommissionRub: 80000, contractInitialPaymentRub: 122000 });
    const config = resolveEffectiveMarketVersion(market, changed);
    assert.equal(config.contractInitialPaymentRub, 122000);
    const quote = calculateAvtocenaFromBusinessConfig({marketId: market, marketConfig: config, sourcePriceRub: 1000000, customsRub: 400000});
    assert.equal(quote.breakdown.find(line => line.id === "security-deposit")?.amountRub, undefined);
    assert.equal(quote.breakdown.find(line => line.id === "car")?.amountRub, 1000000);
    const otherDeposit = calculateAvtocenaFromBusinessConfig({marketId: market, marketConfig: {...config, securityDepositRub: 60000}, sourcePriceRub: 1000000, customsRub: 400000});
    assert.equal(otherDeposit.totalRub, quote.totalRub, "deposit changes allocation, never adds a duplicate expense");
  }
});

test("explicit zero deposit is preserved; malformed or blank editable amounts fail closed", () => {
  assert.deepEqual(marketPaymentFields(form({securityDepositRub: "0", topAvtoCommissionRub: "0"}), "japan"), {
    securityDepositRub: 0, topAvtoCommissionRub: 0, contractInitialPaymentRub: 0,
  });
  for (const field of ["securityDepositRub", "topAvtoCommissionRub"]) {
    for (const bad of ["", "-1", "NaN", "Infinity", "abc"]) {
      assert.throws(() => marketPaymentFields(form({securityDepositRub: "160000", topAvtoCommissionRub: "90000", [field]: bad}), "china"));
    }
  }
});

test("already-open legacy forms preserve the previous contract", () => {
  assert.deepEqual(marketPaymentFields(form({topAvtoCommissionRub: "39000", contractInitialPaymentRub: "70000"}), "japan"), {
    securityDepositRub: 31000, topAvtoCommissionRub: 39000, contractInitialPaymentRub: 70000,
  });
  assert.equal(marketPaymentFields(form({topAvtoCommissionRub: "90000"}), "korea").securityDepositRub, 160000);
  assert.throws(() => marketPaymentFields(form({topAvtoCommissionRub: "90000", contractInitialPaymentRub: "50000"}), "china"));
  assert.throws(() => marketPaymentFields(form({topAvtoCommissionRub: "90000", contractInitialPaymentRub: "bad"}), "china"));
});
