import {fuelFilterKey,type Variant} from './schema';
export const fieldGroups=[
 {title:'Модификация',fields:['year','trim','generation','chassisCode','bodyType','drive','transmission']},
 {title:'Двигатель',fields:['fuel','powertrainKind','engineCode','engineCc','powerHp','powerKw','icePowerKw']},
 {title:'Электрическая часть',fields:['power30MinKw','frontMotor30MinKw','rearMotor30MinKw','motors30MinKw','motorPeakKw','systemPowerKw','batteryKwh']},
 {title:'Дополнительные сведения',fields:['grossVehicleWeightKg']},
] as const;
export const editorFieldGroups=[...fieldGroups,{title:'Внутренние сведения',fields:['sourceUrl','notes']}] as const;
export const fieldChoices:Record<string,string[]>={
 bodyType:['sedan','suv','crossover','hatchback','wagon','minivan','coupe'],
 fuel:['petrol','diesel','electric','hybrid','phev','hev','mhev','lpg','cng'],
 drive:['fwd','rwd','awd'],transmission:['automatic','manual','cvt','dct'],
 powertrainKind:['ice','hev','phev','mhev','series_hybrid','parallel_hybrid','electric'],
};
export function astraDetails(variant:Variant){
 const rows:{label:string;value:string}[]=[];
 const names={approval:'Номер одобрения типа',approvalCH:'Швейцарское одобрение типа',type:'Тип по одобрению',variant:'Вариант по одобрению',version:'Версия по одобрению'} as const;
 for(const field of Object.keys(names) as (keyof typeof names)[]){const value=variant.astraIdentity?.[field];if(typeof value==='string'&&value.trim())rows.push({label:names[field],value});}
 const years=variant.astraEvidence?.manufactureYears;
 if(Array.isArray(years)){const valid=[...new Set(years.filter(year=>Number.isInteger(year)&&year>=1900&&year<=new Date().getUTCFullYear()))].sort((a,b)=>a-b);if(valid.length)rows.push({label:'Годы изготовления',value:valid.join(', ')});}
 return rows;
}
export function filterVariants(variants:Variant[],query:string,filter:string,scope:{fuel?:string;missing30?:boolean}={}){
 const q=query.trim().toLocaleLowerCase('ru');
 return variants.filter(v=>(!q||[v.trim,v.chassisCode,v.engineCode,v.year,v.generation,...Object.values(v.astraIdentity||{})].some(x=>String(x??'').toLocaleLowerCase('ru').includes(q)))
 &&(!scope.fuel||fuelFilterKey(v.fuel)===fuelFilterKey(scope.fuel))
 &&(filter!=='missing30'&&!scope.missing30||(['electric','hybrid'].includes(fuelFilterKey(v.fuel))||/electric|hybrid|hev/i.test(v.powertrainKind||''))&&v.power30MinKw===undefined)
 &&(filter!=='verified'||v.status==='verified')&&(filter!=='review'||v.status!=='verified'));
}
