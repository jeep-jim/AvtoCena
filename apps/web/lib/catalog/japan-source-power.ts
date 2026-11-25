import {canonicalSourceFuel,namedElectrifiedPowertrainKind} from './powertrain-safety';
/** Supplier PW is an approximate discovery hint, never calculation evidence. */
export type JapanPowerSearchHint={offerId:string;values:number[];requiresConfirmation:true};

export function parseJapanSourcePower(value:unknown):number[]{
 if(typeof value!=='string'&&typeof value!=='number')return [];
 const text=String(value).trim();
 if(text.length>200||!/^\d+(?:\.\d+)?(?:\s*,\s*\d+(?:\.\d+)?)*$/.test(text))return [];
 const values=text.split(',').map(Number);
 if(values.length>20||values.some(v=>!Number.isFinite(v)||v<=0||v>2500))return [];
 return [...new Set(values)];
}

export function japanPowerSearchHint(offer:any):JapanPowerSearchHint|undefined{
 if(offer?.market!=='japan'||!/^ajes-stats-[A-Za-z0-9_-]{1,64}$/.test(offer.id||''))return undefined;
 // Exact/manual/encyclopedia facts always win, including a contradictory value.
 if(Number.isFinite(Number(offer.powerHp))&&Number(offer.powerHp)>0)return undefined;
 // The <=160 control mentions recycling fees. PW cannot establish the relevant
 // certified power of a hybrid/EV; do not newly admit these using this fallback.
 const fuels=[offer.fuel,offer.operational?.raw?.sourceFuel].filter(Boolean);
 if(fuels.some(v=>/^(?:H|HE|E)$/i.test(String(v))||['hybrid','electric'].includes(canonicalSourceFuel(v)||''))||namedElectrifiedPowertrainKind(offer)||offer.powertrainKind&&!['unknown','combustion'].includes(offer.powertrainKind)||offer.operational?.fuelDefaultBlocked)return undefined;
 const hint=offer.japanPowerSearchHint;
 if(hint?.offerId===offer.id&&hint.requiresConfirmation===true&&Array.isArray(hint.values)&&hint.values.length>0&&hint.values.length<=20&&hint.values.every((v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>0&&v<=2500)){
  return {offerId:offer.id,values:[...new Set<number>(hint.values)],requiresConfirmation:true};
 }
 if(offer.sourceId!=='ajes_japan_feed')return undefined;
 const values=parseJapanSourcePower(offer.operational?.raw?.sourcePower);
 return values.length?{offerId:offer.id,values,requiresConfirmation:true}:undefined;
}

export function japanPowerSearchLabel(offer:any):string{
 const hint=japanPowerSearchHint(offer);
 return hint?`${hint.values.join(' / ')} л.с. · предварительно`:'';
}
