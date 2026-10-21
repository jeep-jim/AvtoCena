/** Shared by HTML metadata, native share and clipboard text. Never invent missing specs/prices. */
export function offerShareTitle(input:{title:string;year?:unknown;engineCc?:unknown;fuel?:unknown;totalRub?:unknown}) {
  const positive=(v:unknown)=>Number.isFinite(Number(v))&&Number(v)>0?Number(v):0;
  const year=positive(input.year),cc=positive(input.engineCc),price=positive(input.totalRub);
  const name=input.title.replace(/\s+/g,' ').trim().replace(new RegExp(`(?:[ ,—-]+)${year || 'NO_YEAR'}(?:\\s*г\\.?)?$`),'');
  const specs=[year?String(year):'',cc?`${(cc/1000).toLocaleString('ru-RU',{minimumFractionDigits:1,maximumFractionDigits:1})} л`:input.fuel==='electric'?'электро':''].filter(Boolean).join(', ');
  return [name,specs,price?`${Math.round(price).toLocaleString('ru-RU').replace(/\s/g,' ')} ₽`:'Цена уточняется'].filter(Boolean).join(' — ');
}
export function offerShareUrl(locationUrl:string,canonical:string|null,version?:string) {
  const current=new URL(locationUrl),target=new URL(canonical||current.pathname,current.origin);
  // A canonical tag can only select a route within this site.
  if(target.origin!==current.origin)target.href=current.origin+current.pathname;
  target.search='';target.hash='';
  for(const key of ['calculation','direct','powerHp','modificationId','estimate','share','dealer']){const value=current.searchParams.get(key);if(value)target.searchParams.set(key,value);}
  if(version)target.searchParams.set('calculation',version);
  return target.toString();
}

const shareFields=['year','productionMonth','productionDay','fuel','engineCc','powerHp','powerKw','hybridKind','power30MinKw','icePowerKw','vehicleCategory','grossVehicleWeightKg','n1IceFuel','transportToBorderRub','deliveryCity','customsCalculationDate'];
export function encodeShareDraft(input:Record<string,string>){
 const draft=Object.fromEntries(shareFields.filter(k=>input[k]!=null&&input[k]!=='').map(k=>[k,String(input[k])]));
 const bytes=new TextEncoder().encode(JSON.stringify(draft));
 return btoa(Array.from(bytes,b=>String.fromCharCode(b)).join('')).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
export function decodeShareDraft(value:string):Record<string,string>|null{
 if(value.length>2400||! /^[A-Za-z0-9_-]+$/.test(value))return null;
 try{const parsed=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0))));
 if(!parsed||Array.isArray(parsed)||typeof parsed!=='object')return null;
 return Object.fromEntries(shareFields.filter(k=>typeof parsed[k]==='string'&&parsed[k].length<=100).map(k=>[k,parsed[k]]));
 }catch{return null;}
}
