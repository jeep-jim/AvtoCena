import test from "node:test";
import assert from "node:assert/strict";
import { assertNoDeliveredPriceRegression } from "../apps/web/lib/catalog/publication-price-preservation";
import { prepareSellerInventory } from "../apps/web/lib/catalog/prepare-seller-inventory";
import { catalogSearchProjectionSort, searchProjectionFromOffer } from "../apps/web/lib/catalog/storage";
import { sellerPriceLabel } from "../apps/web/lib/catalog/seller-price-contract";

const priced = ():any => ({id:"retained",market:"korea",make:"Renault",model:"QM6",year:2024,
  sourcePrice:1500000, sourceCurrency:"RUB",totalRub:2900000,powertrainKind:"combustion",engineCc:1998,powerHp:140,
  calculationStatus:"ready",calculationSnapshot:{customs:{status:"ready"},breakdown:
    ["car","topavto-commission","broker","svh","laboratory","sbkts","epts","rf-delivery","customs"].map(id=>({id,amountRub:1000}))}});

test("seller inventory cannot erase an existing delivered price even if total card count grows",()=>{
  const old=priced();
  assert.throws(()=>assertNoDeliveredPriceRegression([old],[{...old,totalRub:null,calculationStatus:"needs_data"},...Array.from({length:10},(_,i)=>({...old,id:`new-${i}`}))]),/catalog_delivered_price_regression:1:retained/);
  assert.throws(()=>assertNoDeliveredPriceRegression([old],[]),/catalog_delivered_price_regression/);
  assert.doesNotThrow(()=>assertNoDeliveredPriceRegression([old],[{...old,totalRub:2950000}]));
  // The caller excludes confirmed withdrawals/expiry before passing retained rows.
  assert.doesNotThrow(()=>assertNoDeliveredPriceRegression([],[]));
});

test("explicitly retained published quotes survive inventory preparation without raw replay",async()=>{
  const old=priced(), before=JSON.stringify(old);
  const result=await prepareSellerInventory(old,{preservePublishedPrice:true});
  assert.deepEqual(result,old); assert.notEqual(result,old); assert.equal(JSON.stringify(old),before);
});

test("default market pagination puts delivered quotes before more recent incomplete inventory",()=>{
  const ready={...priced(),updatedAt:"2026-09-01"};
  const pending={...ready,id:"new-incomplete",totalRub:null,updatedAt:"2026-09-08"};
  assert.deepEqual(catalogSearchProjectionSort([pending,ready] as any).map(o=>o.id),["retained","new-incomplete"]);
  assert.deepEqual(catalogSearchProjectionSort([pending,{...ready,year:2020}] as any,"year").map(o=>o.id),["new-incomplete","retained"]);
});

test("auction type and grade survive projection independently of calculation readiness",()=>{
  const row:any=searchProjectionFromOffer({...priced(),market:"japan",catalogKind:"auction_result",auctionGrade:"4.5",totalRub:null,calculationStatus:"needs_data"});
  assert.equal(row.catalogKind,"auction_result");assert.equal(row.auctionGrade,"4.5");
  assert.equal(sellerPriceLabel(row),"Цена на завершённых торгах");
});

test("owner-approved seller transition requires an exact source-price conversion",()=>{
  const old=priced();
  const seller={...old,totalRub:null,catalogPricingMode:"seller",calculationStatus:"needs_data",sellerPriceRub:1500000,
    calculationSnapshot:{currencyRate:{rateSource:"cbr",currency:"RUB",sourcePrice:1500000,effectiveRate:1}}};
  assert.doesNotThrow(()=>assertNoDeliveredPriceRegression([old],[seller],{allowSellerTransition:true}));
  assert.throws(()=>assertNoDeliveredPriceRegression([old],[{...seller,sellerPriceRub:42}],{allowSellerTransition:true}),/regression/);
  assert.throws(()=>assertNoDeliveredPriceRegression([{...old,market:"japan"}],[{...seller,market:"japan"}],{allowSellerTransition:true}),/regression/);
});

test("only recorded pipeline exclusions may remove retained rows",()=>{
  const old=priced();
  assert.doesNotThrow(()=>assertNoDeliveredPriceRegression([old],[],{auditedRemovals:new Map([[old.id,"canonical:identityRejected"]])}));
  for(const reason of ["", "missing", "audit:exception:timeout"])
    assert.throws(()=>assertNoDeliveredPriceRegression([old],[],{auditedRemovals:new Map([[old.id,reason]])}),/regression/);
  assert.throws(()=>assertNoDeliveredPriceRegression([{...old,totalRub:null}],[]),/regression/);
  assert.throws(()=>assertNoDeliveredPriceRegression([old],[{...old,market:"china"}]),/regression/);
  // No removal exceptions are carried into the write/publish checks.
  assert.throws(()=>assertNoDeliveredPriceRegression([old],[],{allowSellerTransition:true}),/regression/);
});
