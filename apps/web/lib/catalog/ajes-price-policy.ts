import type {VehicleOffer} from './types';

export const AJES_CHINA_MAX_RUB = 15_000_000;
/** Owner instruction 18.10.2026: hide second China feed offers above the ceiling. */
export function ajesChinaPriceAllowed(offer:Partial<VehicleOffer>):boolean {
 if(offer.sourceId!=='ajes_china_feed')return true;
 const prices=[offer.sellerPriceRub,offer.totalRub,(offer as any).deliveredCalculationPreview?.totalRub,(offer as any).savedCalculationPreview?.totalRub];
 return !prices.some(value=>Number(value)>AJES_CHINA_MAX_RUB);
}
export function ajesChinaSourceCeiling(effectiveRate:number):number {
 if(!Number.isFinite(effectiveRate)||effectiveRate<=0)throw Error('ajes_currency_unavailable');
 return Math.floor(AJES_CHINA_MAX_RUB/effectiveRate);
}
