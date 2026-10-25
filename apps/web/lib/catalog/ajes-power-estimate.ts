import {isOwnerStepwgnNonHybrid} from './japan-owner-specifications';
import type {VehicleOffer} from './types';

/** Owner-authorized starting value for an editable estimate, never a verified specification. */
export function ajesPowerEstimateHp(offer:Partial<VehicleOffer>):number|undefined {
 const compact=readJapanPowerEstimate(offer as any);if(compact)return compact.values[0];
 if(offer.sourceId!=='ajes_japan_feed')return undefined;
 const raw=offer.operational?.raw as {sourcePower?:unknown}|undefined;
 const value=typeof raw?.sourcePower==='string'?raw.sourcePower.trim():'';
 if(!/^\d+(?:\.\d+)?(?:\s*,\s*\d+(?:\.\d+)?)*$/.test(value))return undefined;
 const hp=Number(value.split(',')[0]);
 return Number.isFinite(hp)&&hp>0&&hp<=2500?hp:undefined;
}

/** Conservative discovery only; never promotes supplier alternatives to exact engine power. */
export function ajesPowerFilterValues(offer:Partial<VehicleOffer>):number[] {
 if(isOwnerStepwgnNonHybrid(offer))return [150];
 if(offer.sourceId!=='ajes_japan_feed')return [];
 const raw=offer.operational?.raw as {sourcePower?:unknown}|undefined;
 const value=typeof raw?.sourcePower==='string'?raw.sourcePower.trim():'';
 if(!/^\d+(?:\.\d+)?(?:\s*,\s*\d+(?:\.\d+)?)*$/.test(value))return [];
 const values=value.split(',').map(Number);
 return values.every(hp=>Number.isFinite(hp)&&hp>0&&hp<=2500)?values:[];
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
