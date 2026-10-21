/** Only identify gaps; never infer a power value from a model name. */
export function missingElectrifiedSpecifications(car:any):string[]{
 const electric=car?.fuel==='electric'||car?.powertrainKind==='electric';
 const hybrid=car?.fuel==='hybrid'||['series_hybrid','other_hybrid'].includes(car?.powertrainKind);
 if(!electric&&!hybrid)return [];
 const missing:string[]=[];
 if(!(Number(car.power30MinKw)>0)&&!(Array.isArray(car.power30MinKwByMotor)&&car.power30MinKwByMotor.length&&car.power30MinKwByMotor.every((n:any)=>Number(n)>0)))missing.push('сертифицированная 30-минутная мощность электромоторов');
 if(hybrid&&!(Number(car.engineCc)>0))missing.push('объём ДВС');
 if(hybrid&&!(Number(car.icePowerKw)>0)&&!(Number(car.powerHp)>0))missing.push('мощность ДВС');
 return missing;
}
export const automaticResearchQuestion=(missing:string[])=>'Найди по источникам недостающие параметры этого автомобиля: '+missing.join(', ')+'. Сразу сообщи найденные значения со ссылками и применимостью к этой версии. Если подтверждения нет, прямо укажи это.';
