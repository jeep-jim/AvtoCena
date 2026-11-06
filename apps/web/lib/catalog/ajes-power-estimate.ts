import {isOwnerStepwgnNonHybrid} from './japan-owner-specifications';
import type {VehicleOffer} from './types';

/** Owner-authorized starting value for an editable estimate, never a verified specification. */
export function ajesPowerEstimateHp(offer:Partial<VehicleOffer>):number|undefined {
 const compact=readJapanPowerEstimate(offer as any);if(compact)return compact.values[0];
 if(isOwnerStepwgnNonHybrid(offer))return 150;
 const hp=Number(offer.powerHp);
 return Number.isFinite(hp)&&hp>0&&hp<=2500?hp:undefined;
}

/** Only explicit owner rules qualify here; supplier PW is never a power fact. */
export function ajesPowerFilterValues(offer:Partial<VehicleOffer>):number[] {
 return isOwnerStepwgnNonHybrid(offer)?[150]:[];
}
export const JAPAN_POWER_FILTER_NOTICE='Отбор Японии по предварительным данным мощности: все указанные варианты входят в выбранный диапазон. Точную мощность уточните перед расчётом.';

export function readJapanPowerEstimate(offer:any):{offerId:string;values:number[];requiresConfirmation:true}|undefined {
 const e=offer.japanPowerEstimate;
 if(offer.market!=='japan'||!/^ajes-stats-[A-Za-z0-9_-]+$/.test(offer.id||'')||e?.offerId!==offer.id||e.requiresConfirmation!==true||!Array.isArray(e.values)||!e.values.length||e.values.length>20||!e.values.every((v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>0&&v<=2500))return undefined;
 return e;
}
export function compactJapanPowerEstimate(offer:any){
 const existing=readJapanPowerEstimate(offer);if(existing)return existing;
 const values=ajesPowerFilterValues(offer);return offer.market==='japan'&&/^ajes-stats-/.test(offer.id||'')&&values.length&&values.length<=20?{offerId:offer.id,values:[...new Set(values)],requiresConfirmation:true as const}:undefined;
}
export function japanPowerEstimateLabel(offer:any){
 // Related/dealer rails may still receive the full offer rather than its public
 // projection. Use the same validated source values as the editable calculator.
 const estimate=compactJapanPowerEstimate(offer);if(!estimate)return '';
 return estimate.values.length===1?`${estimate.values[0]} л.с. · предварительно`:`${estimate.values.join(' / ')} л.с. · уточнить`;
}
