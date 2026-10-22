// Shared with card normalization. Keep this identity/value check browser-safe;
// the private index and its cryptographic digest remain server-only.
export const calculationSourceIdentity=(offer:any)=>JSON.stringify([offer.id,offer.year]);
export function hasEncyclopediaCalculationEvidence(offer:any){
 const e=offer.operational?.encyclopediaCalculation||offer.encyclopediaCalculation;
 return typeof offer.id==='string'&&offer.id.length>0&&e?.version===1&&typeof e.indexDigest==='string'&&e.sourceIdentity===calculationSourceIdentity(offer)
  &&Object.keys(e.values||{}).length>0&&Object.entries(e.values).every(([f,v])=>JSON.stringify(offer[f])===JSON.stringify(v));
}
