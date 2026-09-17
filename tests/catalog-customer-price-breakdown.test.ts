import assert from "node:assert/strict";
import test from "node:test";
import { customerPriceBreakdown } from "../apps/web/lib/catalog/customer-price-breakdown";
import { calculateAvtocenaFromBusinessConfig } from "../packages/engine/src/calculation/calculateAvtocena";

test("customer screenshot cases retain full seller price independently of the advance", () => {
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
    assert.equal(visible.find(line=>line.id==='security-deposit')?.amountRub,undefined);
    assert.equal(visible.reduce((sum,line)=>sum+line.amountRub,0),result.totalRub,market);
    assert.equal(visible.find(line=>line.id==='car')?.note,undefined);
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
  assert.equal(lines.find(line=>line.id==='security-deposit')?.amountRub,undefined);
  assert.equal(lines.reduce((sum,line)=>sum+line.amountRub,0),140000);
  const plain=[{id:'car',title:'Цена автомобиля',amountRub:123456},{id:'manual-adjustment',amountRub:-1000}];
  assert.deepEqual(customerPriceBreakdown(plain),[{id:'car',title:'Цена автомобиля',amountRub:122456}]);
});

test('historical full-price and split snapshots produce the same breakdown with the current advance',()=>{
  for(const deposit of [160000,31000]) {
    const full=[{id:'car',title:'Цена автомобиля',amountRub:1111918},{id:'topavto-commission',amountRub:90000}];
    const old=[{...full[0],amountRub:1111918-110000},{id:'security-deposit',amountRub:110000},full[1]];
    const before=JSON.stringify(old);
    const current=customerPriceBreakdown(full,deposit);
    assert.deepEqual(customerPriceBreakdown(old,deposit),current);
    assert.deepEqual(customerPriceBreakdown(current,deposit),current);
    assert.equal(current.reduce((s,l)=>s+l.amountRub,0),1201918);
    assert.equal(current[0].amountRub,1111918);
    assert.ok(!current.some(line=>line.id==='security-deposit'));
    assert.equal(JSON.stringify(old),before);
  }
});
