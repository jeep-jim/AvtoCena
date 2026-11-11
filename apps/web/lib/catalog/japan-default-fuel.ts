/** Owner policy 2026-10-25: missing Japan fuel defaults to petrol.
 * This is a business default, not supplier/manufacturer evidence. */
export function applyJapanDefaultFuel<T extends Record<string,any>>(offer:T):T {
 if(offer.operational?.fuelDefaultBlocked)return offer;
 if(offer.market!=='japan'||!['','unknown'].includes(String(offer.fuel??'').trim().toLowerCase()))return offer;
 return {...offer,fuel:'petrol',operational:{...offer.operational,
  fuelDefault:{value:'petrol',source:'owner_policy',policyDate:'2026-10-25'}}};
}
