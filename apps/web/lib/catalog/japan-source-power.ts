import {isOwnerStepwgnNonHybrid} from './japan-owner-specifications';

/** Owner-authorized discovery value from the first numeric supplier PW entry.
 * This separate field is not certified power or an input to tax calculations. */
export type JapanPowerSearchHint = {
 offerId:string;
 horsepower:number;
 source:'ajes_pw_first';
 requiresConfirmation:true;
};

const positive=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>0;
export const isAjesJapanPowerOffer=(offer:any):boolean=>offer?.market==='japan'&&/^ajes-stats-[A-Za-z0-9_-]{1,64}$/.test(offer.id||'');

export function firstJapanSourcePower(value:unknown):number|undefined {
 if(typeof value!=='string'&&typeof value!=='number')return undefined;
 if(typeof value==='number')return positive(value)?value:undefined;
 const text=String(value).trim();
 if(!text)return undefined;
 const first=text.match(/[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/);
 if(!first)return undefined;
 const number=Number(first[0]);
 return positive(number)?number:undefined;
}

export function japanPowerSearchHint(offer:any):JapanPowerSearchHint|undefined {
 if(!isAjesJapanPowerOffer(offer)||isOwnerStepwgnNonHybrid(offer)||positive(Number(offer.powerHp)))return undefined;
 const hint=offer.japanPowerSearchHint;
 if(hint?.offerId===offer.id&&hint.source==='ajes_pw_first'&&hint.requiresConfirmation===true&&positive(hint.horsepower))
  return {offerId:offer.id,horsepower:hint.horsepower,source:'ajes_pw_first',requiresConfirmation:true};
 if(offer.sourceId!=='ajes_japan_feed')return undefined;
 const horsepower=firstJapanSourcePower(offer.operational?.raw?.sourcePower);
 return horsepower===undefined?undefined:{offerId:offer.id,horsepower,source:'ajes_pw_first',requiresConfirmation:true};
}

export function japanPowerUnknown(offer:any):boolean {
 return isAjesJapanPowerOffer(offer)&&!isOwnerStepwgnNonHybrid(offer)&&!positive(Number(offer.powerHp))&&!japanPowerSearchHint(offer);
}

export function japanPowerSearchLabel(offer:any):string {
 const hint=japanPowerSearchHint(offer);
 return hint?`${hint.horsepower.toLocaleString('ru-RU')} л.с. · предварительно`:'';
}

export const JAPAN_SOURCE_POWER_NOTICE='Для поиска используем первое значение мощности поставщика, пока оно не подтверждено по документам. Машины без указанной мощности тоже показаны и помечены отдельно. Предварительное значение не подтверждает льготный утильсбор.';
