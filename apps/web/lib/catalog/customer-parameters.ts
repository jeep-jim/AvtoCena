import type { VehicleOffer } from "./types";
export function validateCustomerParameters(input: any): Partial<VehicleOffer> {
  const number = (name: string, min: number, max: number, integer = false) => {
    const n = typeof input?.[name] === "number" || typeof input?.[name] === "string" ? Number(input[name]) : NaN;
    if (!Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n))) throw new Error(`Проверьте поле ${name}`);
    return n;
  };
  const year = number("year",1990,new Date().getUTCFullYear()+1,true);
  const fuel = input?.fuel;
  if (!["petrol","diesel","lpg","cng","electric","hybrid"].includes(fuel)) throw new Error("Укажите тип топлива");
  const powerHp = input?.vehicleCategory === "N1" && (input.powerHp == null || input.powerHp === "") ? undefined : number("powerHp",1,2500);
  const powertrainKind = fuel === "electric" ? "electric" : fuel === "hybrid" ? input.hybridKind : "combustion";
  if (!["electric","combustion","series_hybrid","other_hybrid"].includes(powertrainKind)) throw new Error("Укажите тип гибрида");
  const month = input?.productionMonth === "" || input?.productionMonth == null ? undefined : number("productionMonth",1,12,true);
  const day = input?.productionDay === "" || input?.productionDay == null ? undefined : number("productionDay",1,31,true);
  if (day && (!month || new Date(Date.UTC(year,month-1,day)).getUTCMonth() !== month-1)) throw new Error("Укажите существующий день и месяц выпуска");
  const category = input?.vehicleCategory;
  if (category && !["M1","N1"].includes(category)) throw new Error("Выберите категорию M1 или N1");
  const commercial: Partial<VehicleOffer> = {};
  if (category) commercial.vehicleCategory = category;
  if (input?.transportToBorderRub !== "" && input?.transportToBorderRub != null) commercial.transportToBorderRub = number("transportToBorderRub",0,10000000);
  if (input?.customsCalculationDate) {
    const date = String(input.customsCalculationDate);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10) !== date) throw new Error("Укажите существующую дату расчёта");
    commercial.customsCalculationDate = date;
  }
  if (input?.grossVehicleWeightKg !== "" && input?.grossVehicleWeightKg != null) commercial.grossVehicleWeightKg = number("grossVehicleWeightKg",1,3500,true);
  if (input?.n1IceFuel) {
    if (!["petrol","diesel"].includes(input.n1IceFuel)) throw new Error("Укажите топливо ДВС гибрида");
    commercial.n1IceFuel = input.n1IceFuel;
  }
  return {...commercial,productionDate: month ? `${year}-${String(month).padStart(2,"0")}${day ? `-${String(day).padStart(2,"0")}` : ""}` : undefined,year,fuel,powerHp,powerKw:powerHp == null ? undefined : powerHp * 0.73549875,powertrainKind,
    engineCc:fuel === "electric" ? undefined : number("engineCc",300,10000,true),
    power30MinKw:["electric","hybrid"].includes(fuel) && !(category === "N1" && powertrainKind !== "other_hybrid") ? number("power30MinKw",0.1,2000) : undefined,
    icePowerKw:fuel === "hybrid" && !(category === "N1" && powertrainKind === "series_hybrid") ? number("icePowerKw",0.1,2000) : undefined};
}
