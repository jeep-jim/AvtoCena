import test from 'node:test';
import assert from 'node:assert/strict';
import {isVerifiedPriceOnRequestForAudit as allowed} from '../scripts/lib/visible-audit-price-policy.mjs';

test('owner-approved unpriced Dubicars remain incomplete, never calculated or seller-priced',()=>{
 const row={market:'uae',sourceGroup:'dubicars_uae_exact',cardProjectionVersion:3,calculationStatus:'needs_data',sourcePrice:null,totalRub:null};
 assert.equal(allowed(row),true);
 for(const change of [{market:'china'},{sourceGroup:'unverified'},{cardProjectionVersion:2},{calculationStatus:'ready'},
  {sourcePrice:100},{sourcePrice:0},{totalRub:100},{sellerPriceRub:100},{publicVisibleRub:100},{totalRub:NaN},{totalRub:-1}]){
  assert.equal(allowed({...row,...change}),false,JSON.stringify(change));
 }
});
