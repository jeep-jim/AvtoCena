/** Inventory policy approved 06.10.2026. Dates retain the source's precision. */
export function catalogInventoryDate(offer: any): string | undefined {
 const op=offer.operational||{},raw=op.raw||{},e=op.semanticEvidence?.productionDate;
 const detail=String(raw.detail?.infoid||'')===String(offer.sourceOfferId||'')?raw.detail||{}:{};
 const candidates=[offer.inventorySourceDate,e?.status==='exact'?e.value:undefined,detail.manufacturedate,detail.producedate,offer.productionDate,op.registrationDate,detail.regdate,raw.listing?.regdate];
 for(const value of candidates){
  const m=String(value||'').match(/^((?:19|20)\d{2})[-/.](0?[1-9]|1[0-2])(?:[-/.](0?[1-9]|[12]\d|3[01]))?(?:[ T]00:00:00(?:\.000)?Z?)?$/);
  if(!m)continue;
  const year=Number(m[1]),month=Number(m[2]),day=Number(m[3]);
  if(m[3]&&new Date(Date.UTC(year,month-1,day)).getUTCMonth()!==month-1)continue;
  return `${m[1]}-${String(month).padStart(2,'0')}${m[3]?'-'+String(day).padStart(2,'0'):''}`;
 }
}
export function catalogInventoryAgeDecision(offer:any,now=new Date()){
 const today=new Date(now.getTime()+7*3600000).toISOString().slice(0,10);
 const year=Number(offer.year),current=Number(today.slice(0,4));
 if(offer.market==='japan')return {eligible:Number.isInteger(year)&&year>=2010&&year<=current+1,basis:'japan_2010'};
 const date=catalogInventoryDate(offer);
 if(date){
  // A year/month is not a fabricated exact day: expire when that month ends.
  const cutoff=`${current-6}${today.slice(4)}`.slice(0,date.length);
  return {eligible:date>=cutoff&&date<=today.slice(0,date.length),basis:date.length===10?'source_day':'source_month'};
 }
 return {eligible:Number.isInteger(year)&&year>=current-6&&year<=current,basis:'source_year'};
}
/** Only exact, listing-bound permitted gross mass; never payload or curb mass. */
export function catalogGrossVehicleWeightKg(offer:any):number|undefined {
 const direct=Number(offer.grossVehicleWeightKg);
 if(Number.isFinite(direct)&&direct>0)return direct;
 const op=offer.operational||{},snapshot=op.sourceSpecifications;
 if(op.semanticEvidence?.grossVehicleWeightKg?.status==='conflict'||!snapshot||snapshot.sourceId!==offer.sourceId||snapshot.sourceOfferId!==offer.sourceOfferId)return;
 const values:number[]=[];
 for(const group of snapshot.groups||[])for(const item of group.items||[]){
  const label=String(item.name||'').normalize('NFKC'),raw=String(item.value||'').normalize('NFKC').trim().replace(/(?<=\d)[ ,](?=\d{3}(?:\D|$))/g,'');
  if(!/最大允许总质量|最大总质量|总质量|차량총중량|총중량|полная.*масса|разреш[её]нная.*масса|gross.*(?:weight|mass)|gvwr/i.test(label))continue;
  if(!/kg|кг|킬로그램|千克/i.test(label+' '+raw)||!/^\d{3,5}(?:\s*(?:kg|кг|킬로그램|千克))?$/i.test(raw))continue;
  values.push(Number(raw.match(/^\d+/)?.[0]));
 }
 const unique=[...new Set(values)];if(unique.length===1&&unique[0]>0)return unique[0];
}
/** GVWR is the permitted loaded mass; curb weight is never a substitute. */
export function catalogHeavyVehicleExcluded(offer:any){
 const snapshot=offer.operational?.sourceSpecifications;
 // Legacy paid replay rows may predate body normalization. Only use named,
 // listing-bound body/class fields, never menus or unrelated raw prose.
 const boundBody=snapshot&&snapshot.sourceId===offer.sourceId&&snapshot.sourceOfferId===offer.sourceOfferId
  ?(snapshot.groups||[]).flatMap((group:any)=>(group.items||[])
    .filter((item:any)=>/^(?:级别|车身结构|车辆类型|тип кузова|класс автомобиля|body type|vehicle type)$/i.test(String(item.name||'').trim()))
    .map((item:any)=>String(item.value||''))).join(' '):'';
 const text=[offer.make,offer.model,offer.trim,offer.bodyType,boundBody].join(' ');
 if(/forklift|excavator|bulldozer|tractor|machinery|погрузчик|экскаватор|трактор|工程机械/i.test(text))return true;
 const category=String(offer.vehicleCategory||'').toUpperCase();
 const commercial=/\b(?:truck|lorry|bus|minibus|coach|canter|fighter|dutro|forward|giga|elf|profia|pick[ -]?up)\b|пикап|皮卡|грузов|автобус|货车|卡车|轻卡|微卡|客车|巴士|轻客/i.test(text)||/^N[123]|^M[23]/.test(category);
 const mass=Number(catalogGrossVehicleWeightKg(offer));
 if(/^(?:N[23]|M3)G?$/.test(category))return true;
 return commercial&&Number.isFinite(mass)&&mass>3500;
}
