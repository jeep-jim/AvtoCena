import {legalProductionReference, type RussiaCustomsV2Input} from '../../../../packages/engine/src/calculation/russiaCustomsV2';
import type {VehicleOffer} from './types';

const dayMs=86400000;
/** Exclusive validity limit from the actual inputs used by the unchanged V2
 * rules, not a generic UTC day. Legacy/unsupported rows are bounded by the
 * next UTC day rather than pretending we know their tariff transition. */
export function fxTariffHorizon(offer: Partial<VehicleOffer>, asOf: number): number {
 const now=new Date(asOf), overnight=Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate())+dayMs;
 const yearEnd=Date.UTC(now.getUTCFullYear()+1,0,1);
 const input=offer.calculationSnapshot?.customsInput as RussiaCustomsV2Input|undefined;
 const customs=offer.calculationSnapshot?.customs;
 if (!input || customs?.status!=='ready' || input.newModelYearScenario ||
     !(input.importedAt instanceof Date) || input.importedAt.getTime()!==asOf) return overnight;
 const reference=legalProductionReference(input);
 if(!reference)return overnight;
 const at=(year:number,offset=0)=>Date.UTC(reference.year+year,reference.month-1,reference.day)+offset*dayMs;
 const category=(customs as {vehicleCategory?:string}).vehicleCategory;
 // Compact snapshots may omit category. Explicit N1 inputs still carry it.
 const n1=category==='N1'||input.vehicleCategory==='N1'||String(input.tnVedCode||'').replace(/\D/g,'').startsWith('8704');
 const transitions=n1?[at(3),at(3,1),at(5,1),at(7,1)]:[at(3,1),at(5,1)];
 return Math.min(yearEnd,...transitions.filter(value=>value>asOf));
}
