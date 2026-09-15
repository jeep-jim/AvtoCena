import test from "node:test";
import assert from "node:assert/strict";
import {leadNotice} from "../apps/web/lib/crm-notifications";
test("group notice retains all five selected vehicle links but no internal conversation", () => {
  const selectedOffers = Array.from({length:5},(_,i)=>({id:`car${i}`,title:`Vehicle ${i}`}));
  const text = leadNotice({id:"lead",selectedOffers,internalNote:"HIDDEN",messages:[{text:"HIDDEN"}]});
  for(const offer of selectedOffers) assert.ok(text.includes(`/cars/offer/${offer.id}`));
  assert.doesNotMatch(text,/HIDDEN/);
});
