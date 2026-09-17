import assert from "node:assert/strict";
import test from "node:test";
import {calculateAvtocenaFromBusinessConfig} from "../packages/engine/src/calculation/calculateAvtocena";

test("owner Audi A3 quote: complete cost 2560800, initial 250000, balance 2310800", () => {
 const input = {marketId:"china" as const, sourcePriceRub:130000*11.47, customsRub:480000,
  marketConfig:{securityDepositRub:160000,topAvtoCommissionRub:90000,exportExpensesRub:160000,
   logisticsRub:114700,rfDeliveryRub:130000,brokerRub:95000}};
 const result=calculateAvtocenaFromBusinessConfig(input);
 assert.equal(result.breakdown.find(l=>l.id==='car')?.amountRub,1491100);
 assert.equal(result.totalRub,2560800);
 assert.equal(result.paymentPlan.contractInitialPaymentRub,250000);
 assert.equal(result.paymentPlan.remainingAfterInitialRub,2310800);
 assert.equal(result.paymentPlan.depositAppliedTo,'services');
 assert.equal(result.breakdown.reduce((s,l)=>s+l.amountRub,0),result.totalRub);
 assert.ok(!result.breakdown.some(l=>l.id==='security-deposit'));
 const changed=calculateAvtocenaFromBusinessConfig({...input,marketConfig:{...input.marketConfig,securityDepositRub:100000}});
 assert.equal(changed.totalRub,result.totalRub,'payment timing never changes costs already recorded as services');
 assert.equal(changed.paymentPlan.remainingAfterInitialRub,2370800);
});

test("Japan 31k advances the vehicle payment; full lot price and 39k commission counted once", () => {
 const result=calculateAvtocenaFromBusinessConfig({marketId:'japan',sourcePriceRub:1000000,
  customsRub:400000,marketConfig:{securityDepositRub:31000,topAvtoCommissionRub:39000,logisticsRub:200000}});
 assert.equal(result.totalRub,1639000);
 assert.equal(result.breakdown[0].amountRub,1000000);
 assert.equal(result.paymentPlan.contractInitialPaymentRub,70000);
 assert.equal(result.paymentPlan.remainingAfterInitialRub,1569000);
 assert.equal(result.paymentPlan.depositAppliedTo,'vehicle');
});
