export type CalculationFormSeed={title?:string;url?:string;make?:string;model?:string;market?:string;currency?:string;price?:string;city?:string;draft?:Record<string,string>};
const fields=['title','make','model','market','currency','price','city'] as const;
const draftFields=['year','productionMonth','productionDay','engineCc','fuel','powerHp','powerKw','hybridKind','power30MinKw','power30MinHp','icePowerKw','icePowerHp','vehicleCategory','grossVehicleWeightKg','n1IceFuel','customsCalculationDate','transportToBorderRub','insuranceRub','additionalCostsRub'];
export function calculationFormSeed(value:unknown):CalculationFormSeed {
 const raw=value&&typeof value==='object'?value as Record<string,unknown>:{};
 const seed:CalculationFormSeed={};
 for(const field of fields)if(typeof raw[field]==='string'||typeof raw[field]==='number')seed[field]=String(raw[field]).slice(0,200);
 if(typeof raw.url==='string'){try{const url=new URL(raw.url);if(url.protocol==='https:'&&!url.username&&!url.password)seed.url=url.href.slice(0,2000);}catch{}}
 if(raw.draft&&typeof raw.draft==='object'){
  seed.draft={};for(const field of draftFields){const v=(raw.draft as Record<string,unknown>)[field];if(typeof v==='string'||typeof v==='number')seed.draft[field]=String(v).slice(0,100);}
 }
 return seed;
}
