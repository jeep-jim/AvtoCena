import type {VehicleOffer} from './types';

/** Owner-authorized starting value for an editable estimate, never a verified specification. */
export function ajesPowerEstimateHp(offer:Partial<VehicleOffer>):number|undefined {
 if(offer.sourceId!=='ajes_japan_feed')return undefined;
 const raw=offer.operational?.raw as {sourcePower?:unknown}|undefined;
 const value=typeof raw?.sourcePower==='string'?raw.sourcePower.trim():'';
 if(!/^\d+(?:\.\d+)?(?:\s*,\s*\d+(?:\.\d+)?)*$/.test(value))return undefined;
 const hp=Number(value.split(',')[0]);
 return Number.isFinite(hp)&&hp>0&&hp<=2500?hp:undefined;
}

/** Conservative discovery only; never promotes supplier alternatives to exact engine power. */
export function ajesPowerFilterValues(offer:Partial<VehicleOffer>):number[] {
 if(offer.sourceId!=='ajes_japan_feed')return [];
 const raw=offer.operational?.raw as {sourcePower?:unknown}|undefined;
 const value=typeof raw?.sourcePower==='string'?raw.sourcePower.trim():'';
 if(!/^\d+(?:\.\d+)?(?:\s*,\s*\d+(?:\.\d+)?)*$/.test(value))return [];
 const values=value.split(',').map(Number);
 return values.every(hp=>Number.isFinite(hp)&&hp>0&&hp<=2500)?values:[];
}
export const JAPAN_POWER_FILTER_NOTICE='Отбор Японии по предварительным данным мощности: все указанные варианты входят в выбранный диапазон. Точную мощность уточните перед расчётом.';
