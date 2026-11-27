import {heavyVehicleFamilies} from './heavy-vehicle-families';

/** Explicit Japan catalog exclusions requested by the owner on 22.10.2026.
 * Independent of logo availability: do not remove passenger makes for a missing asset.
 */
const excluded=['FRUEHAUF','GM','HINO','HITACHI','KOMATSU','OTHERS','SUMITOMO','TADANO','TCM','TRAILER'];
export const japanExcludedMake=(make:unknown)=>excluded.includes(String(make||'').normalize('NFKC').trim().toUpperCase());
export const japanMakeSqlExclusion=()=>`marka_name not in (${excluded.map(v=>"'"+v+"'").join(',')})`;

// These Japanese commercial families are absent from the shared legacy list.
// Keep this addition local to Japan instead of changing another market's policy.
// Mazda: https://www.mazda.co.jp/cars/commercial/titan/
// Nissan: https://global.nissannews.com/ja-JP/channels/civilian
const japanCommercialFamilies=[{make:'MAZDA',model:'TITAN'},{make:'NISSAN',model:'CIVILIAN'}] as const;
const normalized=(value:unknown)=>String(value||'').normalize('NFKC').trim().toUpperCase().replace(/\s+/g,' ');
export function japanVehicleFamilyExcluded(make:unknown,model:unknown){
 const brand=normalized(make),name=normalized(model);
 return japanCommercialFamilies.some(family=>brand===family.make&&(name===family.model||[' ','-','/'].some(separator=>name.startsWith(family.model+separator))));
}
const familySql=(makes:readonly string[],models:readonly string[])=>`not (marka_name in (${makes.map(make=>`'${make}'`).join(',')}) and (${models.flatMap(model=>[
 `model_name='${model}'`,...[' ','-','/'].map(separator=>`model_name like '${model}${separator}%'`),
]).join(' or ')}))`;

/** Japan-only wire form: retain the older =/LIKE grammar while grouping makes
 * with identical model families. The shared policy and other markets do not change. */
export function japanHeavyVehicleSqlExclusion(){
 const groups=new Map<string,{makes:string[];models:readonly string[]}>();
 for(const group of heavyVehicleFamilies){
  const key=group.models.join('|'),saved=groups.get(key)||{makes:[],models:group.models};
  saved.makes.push(group.make);groups.set(key,saved);
 }
 return [...groups.values()].map(group=>familySql(group.makes,group.models)).join(' and ');
}
export const japanVehicleFamilySqlExclusion=()=>japanCommercialFamilies.map(({make,model})=>familySql([make],[model])).join(' and ');

/** Exact previous cache identity only; this predicate is not sent to AJ. */
export const japanVehicleFamilyCacheSqlExclusion=()=>`not (${japanCommercialFamilies.map(({make,model})=>`(marka_name='${make}' and model_name regexp '^${model}($|[ /-])')`).join(' or ')})`;

/** Explicit bus/class evidence only: passenger minivans and a generic VAN remain. */
export function japanVehicleTypeExcluded(offer:any,boundBody=''){
 if(offer?.market!=='japan')return false;
 if(japanExcludedMake(offer.make)||japanVehicleFamilyExcluded(offer.make,offer.model))return true;
 const category=normalized(offer.vehicleCategory);
 if(/^(?:N[23]|M[23])G?$/.test(category))return true;
 const body=[offer.bodyType,boundBody].join(' ');
 const text=[offer.model,offer.trim,body].join(' ');
 // COACH can be a passenger-car trim (for example COACH EDITION), so accept
 // it as a bus only in an explicit body classification.
 return /\bcoach\b/i.test(body)||/\b(?:bus|minibus|microbus)\b|автобус|(?:^|[\s/()-])(?:マイクロ)?バス(?:$|[\s/()-])/i.test(text);
}
