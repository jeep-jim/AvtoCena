import type { VehicleOffer } from "./types";

function rawText(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(rawText).join(" ");
  if (typeof value === "object") return Object.values(value as Record<string, unknown>).slice(0, 160).map(rawText).join(" ");
  return "";
}

function offerText(offer: Partial<VehicleOffer>) {
  return [
    offer.make,
    offer.model,
    offer.generation,
    offer.trim,
    offer.engineType,
    offer.fuel,
    offer.transmission,
    offer.drive,
    offer.bodyType,
    rawText(offer.operational?.raw),
  ].filter(Boolean).join(" ").replace(/\s+/g, " ").toLowerCase();
}

function reasonable(value: unknown, min: number, max: number) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? Math.round(number) : undefined;
}

function inferFuel(text: string) {
  if (/\b(?:phev|plug[ -]?in|plug[ -]?in hybrid)\b|插电混动|플러그인|подзаряжаем/.test(text)) return "hybrid";
  if (/\b(?:hybrid|hev|mhev)\b|混合动力|油电混合|하이브리드|гибрид/.test(text)) return "hybrid";
  if (/\b(?:electric|bev|battery electric|ev)\b|纯电|新能源纯电|전기|электро/.test(text)) return "electric";
  if (/\b(?:diesel|tdi|crdi|d-4d|d4d|bluehdi)\b|柴油|디젤|дизел/.test(text)) return "diesel";
  if (/\b(?:lpg|cng|gpl)\b|газ/.test(text)) return "lpg";
  if (/\b(?:petrol|gasoline|benzin|essence|benzina|gasolina|gdi|mpi|t-gdi|tgdi|tsi|tfsi)\b|汽油|가솔린|бензин/.test(text)) return "petrol";
  return undefined;
}

function inferTransmission(text: string) {
  if (/\b(?:cvt|e-cvt|ecvt|xtronic)\b|无级变速|вариатор/.test(text)) return "cvt";
  if (/\b(?:dct|dsg|pdk|dual clutch|double clutch|双离合)\b|робот/.test(text)) return "dct";
  if (/\b(?:manual|mt|stick shift|schaltgetriebe|manuelle)\b|手动|수동|механик/.test(text)) return "manual";
  if (/\b(?:automatic|automatik|automatique|automatica|automático|auto|a\/t|at|tiptronic)\b|自动|오토|자동|автомат/.test(text)) return "automatic";
  return undefined;
}

function inferDrive(text: string) {
  if (/\b(?:awd|4wd|4x4|quattro|xdrive|4matic|allroad|all wheel drive|four wheel drive|allrad)\b|四驱|사륜|полный привод/.test(text)) return "awd";
  if (/\b(?:rwd|rear wheel drive|heckantrieb|fr)\b|后驱|후륜|задний привод/.test(text)) return "rwd";
  if (/\b(?:fwd|front wheel drive|frontantrieb|ff|2wd)\b|前驱|两驱|전륜|передний привод/.test(text)) return "fwd";
  return undefined;
}

function inferBody(text: string) {
  if (/\b(?:pickup|pick-up|double cab|single cab|crew cab)\b|皮卡|пикап/.test(text)) return "pickup";
  if (/\b(?:panel van|cargo van|delivery van|commercial van)\b|фургон/.test(text)) return "van";
  if (/\b(?:minivan|mpv|people mover|staria|starex|h-1|carnival|odyssey|sienna|alphard|vellfire|serena|stepwgn|stepwagon|noah|voxy|freed)\b|минивэн/.test(text)) return "minivan";
  if (/\b(?:convertible|cabrio|cabriolet|roadster|spider)\b|кабриолет/.test(text)) return "convertible";
  if (/\b(?:coupe|coupé)\b|쿠페|купе/.test(text)) return "coupe";
  if (/\b(?:wagon|estate|touring|avant|kombi|shooting brake)\b|旅行车|универсал/.test(text)) return "wagon";
  if (/\b(?:hatchback|hatch|fastback)\b|两厢|хэтчбек/.test(text)) return "hatchback";
  if (/\b(?:sedan|saloon|limousine|notchback)\b|轿车|三厢|седан/.test(text)) return "sedan";
  if (/\b(?:suv|crossover|offroad|off-road|4x4|sport utility|gv60|gv70|gv80|tucson|santa fe|santafe|sorento|sportage|palisade|kona|seltos|casper|venue|niro|korando|rexton|torres|glc|gle|gls|x1|x2|x3|x4|x5|x6|x7|q2|q3|q5|q7|q8|rav4|harrier|land cruiser|cr-v|vezel|cx-3|cx-30|cx-4|cx-5|cx-8|cx-9)\b|越野车|кроссовер|внедорожник/.test(text)) return "suv";
  return undefined;
}

function inferEngineCc(text: string) {
  const cc = text.match(/\b([3-9]\d{2}|[1-9]\d{3}|10\s?000)\s*(?:cc|cm3|cm³|см3|см³)\b/i);
  if (cc) return reasonable(cc[1].replace(/\s/g, ""), 300, 10_000);
  const liters = text.match(/(?:^|\s)([0-9](?:[.,][0-9]){1,2})\s*(?:l|литр|литра|литров)(?:\s|$)/i)
    || text.match(/\b(?:engine|motor|двигатель|объ[её]м)\s*[:\-]?\s*([0-9](?:[.,][0-9]){1,2})\b/i);
  if (liters) return reasonable(Number(liters[1].replace(",", ".")) * 1_000, 300, 10_000);
  return undefined;
}

function inferPowerHp(text: string) {
  const hp = text.match(/\b([2-9]\d|[1-9]\d{2}|1\d{3})\s*(?:hp|ps|bhp|cv|л\.?\s*с\.?)\b/i);
  if (hp) return reasonable(hp[1], 20, 2_500);
  const kw = text.match(/\b([1-9]\d{1,3})\s*kw\b/i);
  if (kw) return reasonable(Number(kw[1]) * 1.35962, 20, 2_500);
  return undefined;
}

export function normalizeVehicleOfferSpecs<T extends Partial<VehicleOffer>>(offer: T): T {
  const text = offerText(offer);
  const engineCc = reasonable(offer.engineCc, 300, 10_000) || inferEngineCc(text);
  const powerHp = reasonable(offer.powerHp, 20, 2_500) || inferPowerHp(text);
  const powerKw = reasonable(offer.powerKw, 10, 2_000) || (powerHp ? Math.round(powerHp / 1.35962) : undefined);
  return {
    ...offer,
    fuel: inferFuel(`${offer.fuel || ""} ${text}`) || offer.fuel,
    transmission: inferTransmission(`${offer.transmission || ""} ${text}`) || offer.transmission,
    drive: inferDrive(`${offer.drive || ""} ${text}`) || offer.drive,
    bodyType: inferBody(`${offer.bodyType || ""} ${text}`) || offer.bodyType,
    engineCc,
    powerHp,
    powerKw,
  };
}
