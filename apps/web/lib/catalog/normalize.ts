const aliases: Record<string,string> = { toyota:"Toyota", "丰田":"Toyota", honda:"Honda", "本田":"Honda", kia:"Kia", "기아":"Kia", hyundai:"Hyundai", "현대":"Hyundai", benz:"Mercedes-Benz", mercedes:"Mercedes-Benz" };
export function normalizeBrand(value:string){ const key=value.trim().toLowerCase(); return aliases[key] || value.trim().replace(/\s+/g," "); }
export function normalizeModel(value:string){ return value.trim().replace(/\s+/g," "); }
