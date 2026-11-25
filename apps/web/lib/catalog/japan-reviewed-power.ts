import type {VehiclePowerKnowledge} from './power-knowledge';
import type {VehicleOffer} from './types';

// Exact model/year/engine identity, documented manufacturer or registry facts.
// Intentionally refuse engine-less, ambiguous or supplier-only power references.
const key=(v:unknown)=>String(v??'').toLocaleLowerCase('ru-RU').replace(/ё/g,'е').replace(/[^\p{L}\p{N}]+/gu,'');
const valid=(n:unknown)=>typeof n==='number'&&Number.isFinite(n)&&n>0&&n<=2500;

export function reviewedJapanPower(offer:Partial<VehicleOffer>,facts:ReadonlyArray<VehiclePowerKnowledge>):
 {powerHp:number;referenceId:string}|null {
 if(offer.market!=='japan'||!offer.make||!offer.model||
    !Number.isSafeInteger(Number(offer.year))||!valid(Number(offer.engineCc))||
    valid(Number(offer.powerHp)))return null;
 const make=key(offer.make),model=key(offer.model),year=Number(offer.year),cc=Number(offer.engineCc);
 const matches=facts.filter(r=>{
   const tolerance=Math.min(80,Math.max(20,Number(r.engineCcTolerance||80)));
   if(r.active===false||!['manufacturer','registry'].includes(r.confidence)||
      !Array.isArray(r.sourceIds)||!r.sourceIds.length||
      !Number.isFinite(Date.parse(r.verifiedAt))||!valid(r.powerHp)||
      key(r.make)!==make||![r.model,...(r.aliases||[])].some(m=>key(m)===model)||
      (!Number.isSafeInteger(r.yearFrom)&&!Number.isSafeInteger(r.yearTo))||
      (r.yearFrom!==undefined&&year<r.yearFrom)||(r.yearTo!==undefined&&year>r.yearTo)||
      !valid(Number(r.engineCc))||Math.abs(Number(r.engineCc)-cc)>tolerance)
     return false;
   if(r.fuel&&(!offer.fuel||key(r.fuel)!==key(offer.fuel)))return false;
   if(r.powertrainKind&&offer.powertrainKind&&offer.powertrainKind!=='unknown'&&r.powertrainKind!==offer.powertrainKind)return false;
   if(r.trimContains?.length){
     const specified=key([offer.generation,offer.trim,offer.engineType].filter(Boolean).join(' '));
     if(!r.trimContains.every(part=>specified.includes(key(part))))return false;
   }
   return true;
 });
 if(!matches.length)return null;
 // If even one adequately constrained source conflicts, never choose the most convenient output.
 const powers=new Set(matches.map(r=>Math.round(r.powerHp*10)/10));
 if(powers.size!==1)return null;
 return {powerHp:[...powers][0],referenceId:matches[0].id};
}
