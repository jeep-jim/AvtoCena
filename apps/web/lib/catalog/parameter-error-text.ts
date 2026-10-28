const names:Record<string,string>={year:"год выпуска",productionMonth:"месяц выпуска",productionDay:"день выпуска",transportToBorderRub:"стоимость доставки до границы",engineCc:"объём двигателя",powerHp:"мощность",powerKw:"мощность в кВт",power30MinKw:"30-минутную мощность",icePowerKw:"мощность ДВС",grossVehicleWeightKg:"полную разрешённую массу (до 3500 кг)"};
export function parameterErrorText(error: unknown, draft: Record<string,string>) {
 const message=error instanceof Error?error.message:"Проверьте параметры";
 const key=message.match(/^Проверьте поле (\w+)$/)?.[1];
 if(!key)return message;
 const powerBlock=draft.fuel==="hybrid"?"Мощность гибрида":"30-минутная мощность";
 const tile=({powerHp:"Мощность",powerKw:"Мощность",power30MinKw:powerBlock,icePowerKw:powerBlock,year:"Дата выпуска",productionMonth:"Дата выпуска",productionDay:"Дата выпуска",engineCc:"Объём двигателя"} as Record<string,string>)[key];
 const missing=draft[key]==null || String(draft[key]).trim()==="";
 return `${missing?"Для расчёта под ключ заполните":"Проверьте"} ${names[key]||key}${tile?` в разделе «${tile}»`:""}.`;
}
