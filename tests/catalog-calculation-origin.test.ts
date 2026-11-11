import test from "node:test";
import assert from "node:assert/strict";
import {isCalculationOriginAllowed} from "../apps/web/lib/catalog/calculation-request-origin";
test("public HTTPS origin works behind the container proxy",()=>{
 assert.equal(isCalculationOriginAllowed(new Request("http://container:3000/api/calculate",{headers:{origin:"https://avtocena.com"}})),true);
 assert.equal(isCalculationOriginAllowed(new Request("http://localhost:3000/api/calculate",{headers:{origin:"http://localhost:3000"}})),true);
});
test("untrusted forwarded headers cannot authorize a foreign site",()=>{
 for(const origin of ["https://evil.example","https://avtocena.com.evil.example","null","http://avtocena.com"])
 assert.equal(isCalculationOriginAllowed(new Request("http://container:3000/api/calculate",{headers:{origin,"x-forwarded-host":"evil.example"}})),false);
});

import {isVerifiedSellerOnlyForAudit,summarizePendingCalculationsForAudit} from "../apps/web/lib/catalog/visible-audit-policy";
test("incomplete seller inventory is allowed only with a bound currency conversion and no delivered quote",()=>{
 const seller:any={catalogPricingMode:"seller",calculationStatus:"needs_data",sourcePrice:100,sourceCurrency:"USD",sellerPriceRub:9000,totalRub:null,calculationSnapshot:{currencyRate:{rateSource:"cbr",currency:"USD",sourcePrice:100,effectiveRate:90}}};
 assert.equal(isVerifiedSellerOnlyForAudit(seller),true);
 for(const changed of [{sellerPriceRub:1},{sourcePrice:101},{totalRub:9000},{calculationSnapshot:{}},{catalogPricingMode:undefined}])
  assert.equal(isVerifiedSellerOnlyForAudit({...seller,...changed}),false);
});


test("release audit retains missing-calculation coverage but permits verified seller inventory",()=>{
 const seller:any={catalogPricingMode:"seller",calculationStatus:"needs_data",sourcePrice:100,sourceCurrency:"USD",sellerPriceRub:9000,totalRub:null,calculationSnapshot:{currencyRate:{rateSource:"cbr",currency:"USD",sourcePrice:100,effectiveRate:90}}};
 assert.deepEqual(summarizePendingCalculationsForAudit([seller,{calculationStatus:"ready"}]),{needsData:1,verifiedSellerNeedsData:1,blockingNeedsData:0});
 for(const changed of [{sellerPriceRub:1},{totalRub:9000},{catalogPricingMode:undefined},{calculationSnapshot:{}}]) {
  assert.deepEqual(summarizePendingCalculationsForAudit([seller,{...seller,...changed}]),{needsData:2,verifiedSellerNeedsData:1,blockingNeedsData:1});
 }
});
