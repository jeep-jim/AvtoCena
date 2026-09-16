import assert from "node:assert/strict";
import test from "node:test";
import { customerPriceBreakdown } from "../apps/web/lib/catalog/customer-price-breakdown";
import { calculateAvtocenaFromBusinessConfig } from "../packages/engine/src/calculation/calculateAvtocena";

test("customer screenshot cases show the complete seller price without adding the deposit twice", () => {
  for (const [market, price, deposit] of [
    ["china",577160,160000], ["china",835828,160000],
    ["korea",793333,110000], ["korea",1082962,110000],
    ["uae",837409,110000], ["georgia",1643010,110000],
    ["europe",1800000,110000], ["japan",900000,31000],
  ] as const) {
    const result = calculateAvtocenaFromBusinessConfig({marketId:market,sourcePriceRub:price,
      customsRub:500000, marketConfig:{securityDepositRub:deposit,topAvtoCommissionRub:90000,exchangeRateReservePercent:2}});
    const before = JSON.stringify(result);
    const visible = customerPriceBreakdown(result.breakdown);
    assert.equal(visible.find(line=>line.id==='car')?.amountRub,price,market);
    assert.ok(!visible.some(line=>line.id==='security-deposit'));
    assert.equal(visible.reduce((sum,line)=>sum+line.amountRub,0),result.totalRub,market);
    assert.match(visible.find(line=>line.id==='car')?.note || '',/входит в цену/);
    assert.equal(JSON.stringify(result),before,'stored snapshot is immutable');
    assert.deepEqual(customerPriceBreakdown(visible),visible,'projection is idempotent');
  }
});

test("fully prepaid vehicle remains visible and zero-deposit quotes stay unchanged", () => {
  const result = calculateAvtocenaFromBusinessConfig({marketId:'korea',sourcePriceRub:50000,
    marketConfig:{securityDepositRub:110000,topAvtoCommissionRub:90000}});
  const lines=customerPriceBreakdown(result.breakdown);
  assert.equal(lines[0].id,'car');
  assert.equal(lines[0].amountRub,50000);
  assert.equal(lines.reduce((sum,line)=>sum+line.amountRub,0),140000);
  const plain=[{id:'car',title:'Цена автомобиля',amountRub:123456},{id:'manual-adjustment',amountRub:-1000}];
  assert.deepEqual(customerPriceBreakdown(plain),plain);
});
