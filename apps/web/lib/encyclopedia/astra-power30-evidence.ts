/** Browser-safe, identity-bound proof. Source documents stay in the private index. */
export type AstraPower30Evidence={version:1;indexDigest:string;sourceIdentity:string;value:number;inputs:Record<string,unknown>};
export const astraOfferIdentity=(o:any)=>JSON.stringify([o.id,o.year,o.make,o.model,o.chassisCode||o.operational?.chassisCode||o.operational?.modelCode||null,o.astraIdentity||o.typeApprovalIdentity||o.operational?.typeApprovalIdentity||null]);
export function hasAstraPower30Evidence(o:any):boolean {
 const e=o.astraPower30Evidence;
 return Boolean(o.id&&e?.version===1&&/^[a-f0-9]{64}$/.test(e.indexDigest||'')&&e.sourceIdentity===astraOfferIdentity(o)
  &&Number(e.value)>0&&e.value===o.power30MinKw&&e.inputs&&Object.keys(e.inputs).length
  &&Object.entries(e.inputs).every(([k,v])=>JSON.stringify(o[k])===JSON.stringify(v)));
}
