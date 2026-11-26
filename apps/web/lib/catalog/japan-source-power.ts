import {isOwnerStepwgnNonHybrid} from './japan-owner-specifications';

/** AJ confirmed PW is one integer horsepower value. The wire column is varchar(30).
 * Keep this supplier fact separate from local/edited and certified calculation power.
 */
export type JapanSupplierPower={offerId:string;hp:number;unit:'hp';source:'ajes_pw'};

export function parseJapanSourcePower(value:unknown):number|undefined {
 if(typeof value!=='string'&&typeof value!=='number')return undefined;
 const text=String(value).trim();
 if(text.length>30||!/^\d+$/.test(text))return undefined;
 const hp=Number(text);
 return Number.isSafeInteger(hp)&&hp>0?hp:undefined;
}

export function isAjesJapanOffer(offer:any):boolean {
 return offer?.market==='japan'&&/^ajes-stats-[A-Za-z0-9_-]{1,64}$/.test(offer.id||'')
  &&(offer.sourceId===undefined||offer.sourceId==='ajes_japan_feed');
}

export function japanLocalPowerHp(offer:any):number|undefined {
 if(isOwnerStepwgnNonHybrid(offer))return 150;
 const hp=Number(offer?.powerHp);
 return Number.isFinite(hp)&&hp>0?hp:undefined;
}

/** A compact public fact is bound to one listing and cannot populate calculation fields. */
export function japanSupplierPower(offer:any):JapanSupplierPower|undefined {
 if(!isAjesJapanOffer(offer)||japanLocalPowerHp(offer)!==undefined)return undefined;
 const saved=offer.japanSupplierPower;
 if(saved?.offerId===offer.id&&saved.unit==='hp'&&saved.source==='ajes_pw'
   &&typeof saved.hp==='number'&&parseJapanSourcePower(saved.hp)!==undefined){
  return {offerId:offer.id,hp:saved.hp,unit:'hp',source:'ajes_pw'};
 }
 if(offer.sourceId!=='ajes_japan_feed')return undefined;
 const hp=parseJapanSourcePower(offer.operational?.raw?.sourcePower);
 return hp===undefined?undefined:{offerId:offer.id,hp,unit:'hp',source:'ajes_pw'};
}

export function japanSupplierPowerLabel(offer:any):string {
 const power=japanSupplierPower(offer);
 return power?`${power.hp} л.с. · поставщик`:'';
}

export function japanUnknownPower(offer:any):boolean {
 return isAjesJapanOffer(offer)&&japanLocalPowerHp(offer)===undefined&&!japanSupplierPower(offer);
}

export type JapanPowerFilterSummary={shown:number;localPower:number;supplierPower:number;unknownPower:number};
export function japanPowerFilterSummary(items:readonly any[]):JapanPowerFilterSummary {
 let localPower=0,supplierPower=0,unknownPower=0;
 for(const offer of items){
  if(japanLocalPowerHp(offer)!==undefined)localPower++;
  else if(japanSupplierPower(offer))supplierPower++;
  else unknownPower++;
 }
 return {shown:items.length,localPower,supplierPower,unknownPower};
}

export function japanPowerFilterNotice(summary:JapanPowerFilterSummary):string {
 const parts:string[]=[];
 if(summary.supplierPower)parts.push(`Мощность по данным поставщика: ${summary.supplierPower}.`);
 if(summary.unknownPower)parts.push(`Мощность не указана: ${summary.unknownPower} — эти автомобили оставлены в подборке.`);
 if(summary.supplierPower||summary.unknownPower)parts.push('Отбор не подтверждает право на льготный утилизационный сбор.');
 return parts.join(' ');
}
