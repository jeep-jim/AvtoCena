import assert from "node:assert/strict";
import test from "node:test";
import { encarNonCashContractReason, isEncarNonCashContract } from "../apps/web/lib/catalog/encar-sale-contract";

test("Encar 42435312 rent succession advertising price is not a cash vehicle price", () => {
  const exactDetail = {
    category: { originPrice: 6186 },
    advertisement: {
      price: 900,
      oneLineText: "총비용 최저가 렌트차량, 승계지원금 250만원, 즉시승계 가능",
      leaseRentInfo: { residualMonth: 40, monthlyFee: 75, advancePrice: null, depositPrice: null },
      advertisementType: "RENT_SUCCESSION",
    },
  };
  assert.equal(isEncarNonCashContract(exactDetail), true);
  assert.match(encarNonCashContractReason(exactDetail), /RENT_SUCCESSION/);
});

test("normal Encar cash advertisement is not rejected", () => {
  const cashDetail = {
    category: { originPrice: 6186 },
    advertisement: {
      price: 5600,
      advertisementType: "AD_NORMAL",
      leaseRentInfo: null,
    },
  };
  assert.equal(isEncarNonCashContract(cashDetail), false);
  assert.equal(encarNonCashContractReason(cashDetail), "");
});

test("monthly lease contract is rejected even when type key is absent", () => {
  assert.equal(isEncarNonCashContract({ advertisement: { leaseRentInfo: { residualMonth: 24, monthlyFee: 91 } } }), true);
});
