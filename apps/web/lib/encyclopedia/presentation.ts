import {fuelFilterKey,type Variant} from './schema';
export const fieldGroups=[
 {title:'Модификация',fields:['year','trim','generation','chassisCode','bodyType','drive','transmission']},
 {title:'Двигатель',fields:['fuel','powertrainKind','engineCode','engineCc','powerHp','powerKw','icePowerKw']},
 {title:'Электрическая часть',fields:['power30MinKw','frontMotor30MinKw','rearMotor30MinKw','motors30MinKw','motorPeakKw','systemPowerKw','batteryKwh']},
 {title:'Источник и дополнительные сведения',fields:['grossVehicleWeightKg','sourceUrl','notes']},
] as const;
export const fieldChoices:Record<string,string[]>={
 bodyType:['sedan','suv','crossover','hatchback','wagon','minivan','coupe'],
 fuel:['petrol','diesel','electric','hybrid','phev','hev','mhev','lpg','cng'],
 drive:['fwd','rwd','awd'],transmission:['automatic','manual','cvt','dct'],
 powertrainKind:['ice','hev','phev','mhev','series_hybrid','parallel_hybrid','electric'],
};
export function filterVariants(variants:Variant[],query:string,filter:string,scope:{fuel?:string;missing30?:boolean}={}){
 const q=query.trim().toLocaleLowerCase('ru');
 return variants.filter(v=>(!q||[v.trim,v.chassisCode,v.engineCode,v.year,v.generation].some(x=>String(x??'').toLocaleLowerCase('ru').includes(q)))
 &&(!scope.fuel||fuelFilterKey(v.fuel)===fuelFilterKey(scope.fuel))
 &&(filter!=='missing30'&&!scope.missing30||(['electric','hybrid'].includes(fuelFilterKey(v.fuel))||/electric|hybrid|hev/i.test(v.powertrainKind||''))&&v.power30MinKw===undefined)
 &&(filter!=='verified'||v.status==='verified')&&(filter!=='review'||v.status!=='verified'));
}
