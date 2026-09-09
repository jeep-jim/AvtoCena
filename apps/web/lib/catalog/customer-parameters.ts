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
  const powerHp = number("powerHp",1,2500);
  const powertrainKind = fuel === "electric" ? "electric" : fuel === "hybrid" ? input.hybridKind : "combustion";
  if (!["electric","combustion","series_hybrid","other_hybrid"].includes(powertrainKind)) throw new Error("Укажите тип гибрида");
  const month = input?.productionMonth === "" || input?.productionMonth == null ? undefined : number("productionMonth",1,12,true);
  return {productionDate: month ? `${year}-${String(month).padStart(2,"0")}` : undefined,year,fuel,powerHp,powerKw:powerHp * 0.73549875,powertrainKind,
    engineCc:fuel === "electric" ? undefined : number("engineCc",300,10000,true),
    power30MinKw:["electric","hybrid"].includes(fuel) ? number("power30MinKw",0.1,2000) : undefined,
    icePowerKw:fuel === "hybrid" ? number("icePowerKw",0.1,2000) : undefined};
}
