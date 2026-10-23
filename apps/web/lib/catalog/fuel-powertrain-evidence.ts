// A compact copy of already-classified evidence, never a source of new facts.
export type FuelPowertrainEvidence = {version:1;identity:string;fuel:string;powertrainKind:string};
const clean=(value:unknown)=>String(value??'').replace(/\s+/g,' ').trim();
export const fuelPowertrainIdentity=(offer:any)=>JSON.stringify(['id','market','make','model','year','trim'].map(field=>clean(offer[field])));
export function hasFuelPowertrainEvidence(offer:any){
 const proof=offer.fuelPowertrainEvidence;
 return Boolean(offer.id && proof?.version===1 && proof.identity===fuelPowertrainIdentity(offer)
  &&proof.fuel===clean(offer.fuel)&&proof.powertrainKind===clean(offer.powertrainKind));
}
