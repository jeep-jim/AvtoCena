import type { VehicleOffer } from "./types";

function rawText(value: unknown, depth = 0): string {
  if (value == null || depth > 10) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.slice(0, 240).map((item) => rawText(item, depth + 1)).join(" ");
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .slice(0, 240)
      .map(([key, item]) => `${key} ${rawText(item, depth + 1)}`)
      .join(" ");
  }
  return "";
}

function primaryText(offer: Partial<VehicleOffer>) {
  return [offer.make, offer.model, offer.generation, offer.trim, offer.engineType, offer.fuel, offer.transmission, offer.drive, offer.bodyType]
    .filter(Boolean).join(" ").replace(/\s+/g, " ").toLowerCase();
}

function allText(offer: Partial<VehicleOffer>) {
  return `${primaryText(offer)} ${rawText(offer.operational?.raw)}`.replace(/\s+/g, " ").toLowerCase();
}

function reasonable(value: unknown, min: number, max: number) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? Math.round(number) : undefined;
}

function normalizedKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9а-яё\p{L}]+/gu, "");
}

function scalarNumber(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string") return undefined;
  const match = value.replace(/,/g, ".").match(/-?\d+(?:\.\d+)?/);
  if (!match) return undefined;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function findStructuredNumber(value: unknown, keys: string[], depth = 0): number | undefined {
  if (value == null || depth > 10 || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findStructuredNumber(item, keys, depth + 1);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  const wanted = new Set(keys.map(normalizedKey));
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (!wanted.has(normalizedKey(key))) continue;
    const parsed = scalarNumber(item);
    if (parsed !== undefined) return parsed;
  }
  for (const item of Object.values(value as Record<string, unknown>)) {
    const found = findStructuredNumber(item, keys, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

function inferFuel(text: string) {
  if (/phev|plug[ -]?in|hybrid|hev|mhev|reev|range extender|гибрид|混合动力|增程|하이브리드/.test(text)) return "hybrid";
  if (/diesel|tdi|crdi|d-4d|d4d|bluehdi|dci|hdi|дизел|柴油|디젤/.test(text)) return "diesel";
  if (/lpg|cng|gpl|газ/.test(text)) return "lpg";
  if (/petrol|gasoline|benzin|essence|gdi|mpi|tgdi|tsi|tfsi|бензин|汽油|가솔린/.test(text)) return "petrol";
  if (/electric|battery electric|\bbev\b|\bev\b|электро|纯电|전기/.test(text)) return "electric";
  return undefined;
}

function inferTransmission(text: string) {
  if (/cvt|e-cvt|ecvt|xtronic|вариатор|无级变速/.test(text)) return "cvt";
  if (/dct|dsg|pdk|dual clutch|робот|双离合/.test(text)) return "dct";
  if (/manual|\bmt\b|stick shift|механик|手动|수동/.test(text)) return "manual";
  if (/automatic|automatik|\bauto\b|a\/t|\bat\b|автомат|自动|오토|자동/.test(text)) return "automatic";
  return undefined;
}

function inferDrive(text: string) {
  if (/\b(?:awd|4wd|4x4)\b|all[ -]?wheel(?: drive)?|four[ -]?wheel(?: drive)?|quattro|xdrive|4matic|allroad|полный привод|四驱|사륜/.test(text)) return "awd";
  if (/\brwd\b|rear[ -]?wheel(?: drive)?|задний привод|后驱|후륜/.test(text)) return "rwd";
  if (/\bfwd\b|front[ -]?wheel(?: drive)?|\b2wd\b|передний привод|前驱|两驱|전륜/.test(text)) return "fwd";
  return undefined;
}

function inferBody(text: string) {
  if (/pickup|pick-up|double cab|single cab|crew cab|пикап|皮卡/.test(text)) return "pickup";
  if (/panel van|cargo van|commercial van|фургон/.test(text)) return "van";
  if (/minivan|\bmpv\b|staria|starex|carnival|odyssey|sienna|alphard|vellfire|serena|stepwgn|noah|voxy|freed|минивэн/.test(text)) return "minivan";
  if (/convertible|cabrio|roadster|кабриолет/.test(text)) return "convertible";
  if (/coupe|coupé|купе|쿠페/.test(text)) return "coupe";
  if (/wagon|estate|touring|avant|универсал|旅行车/.test(text)) return "wagon";
  if (/hatchback|hatch|fastback|хэтчбек|两厢/.test(text)) return "hatchback";
  if (/sedan|saloon|limousine|седан|轿车|三厢/.test(text)) return "sedan";
  if (/\boff[ -]?road\b|внедорожник|越野车|land cruiser|\bprado\b|\bpatrol\b|\bdefender\b|\bwrangler\b|\bbronco\b|\bfortuner\b|\bpajero\b|\bmontero\b|\bjimny\b|\b4runner\b|g[- ]?class|\bg\s?(?:350|400|500|550|580|63)\b|\bhummer\b/.test(text)) return "offroad";
  if (/suv|crossover|rav4|harrier|cr-v|vezel|cx-5|glc|gle|gls|\bx[1-7]\b|\bq[23578]\b|кроссовер/.test(text)) return "suv";
  return undefined;
}

function inferEngineCc(text: string) {
  const cc = text.match(/\b([3-9]\d{2}|[1-9]\d{3}|10\s?000)\s*(?:cc|cm3|cm³|см3|см³|куб\.?\s*см)\b/i);
  if (cc) return reasonable(cc[1].replace(/\s/g, ""), 300, 10_000);
  const liters = text.match(/(?:^|\s)([0-9](?:[.,][0-9]){1,2})\s*(?:l|л|литр)/i);
  return liters ? reasonable(Number(liters[1].replace(",", ".")) * 1000, 300, 10_000) : undefined;
}

function inferPowerHp(text: string) {
  const hp = text.match(/\b([2-9]\d|[1-9]\d{2}|1\d{3})\s*(?:hp|ps|bhp|cv|ch|л\.?\s*с\.?|лс|马力|匹|마력|ცხ\.?\s*ძ\.?)\b/i);
  if (hp) return reasonable(hp[1], 20, 2500);
  const georgian = text.match(/\b([2-9]\d|[1-9]\d{2}|1\d{3})\s*ცხენის\s+ძალა/i);
  if (georgian) return reasonable(georgian[1], 20, 2500);
  const kw = text.match(/\b([1-9]\d{1,3})\s*(?:kw|квт|квт\.|კვტ)\b/i);
  return kw ? reasonable(Number(kw[1]) * 1.35962, 20, 2500) : undefined;
}

function structuredPowerHp(offer: Partial<VehicleOffer>) {
  const raw = offer.operational?.raw;
  const hp = findStructuredNumber(raw, [
    "powerHp", "power_hp", "horsePower", "horse_power", "horsepower", "enginePowerHp", "maxPowerHp", "hp", "ps", "cv",
  ]);
  if (reasonable(hp, 20, 2500)) return reasonable(hp, 20, 2500);
  const kw = findStructuredNumber(raw, [
    "powerKw", "power_kw", "enginePowerKw", "engine_power_kw", "motorPowerKw", "maxPowerKw", "kw",
  ]);
  if (reasonable(kw, 10, 2000)) return reasonable(Number(kw) * 1.35962, 20, 2500);
  const generic = findStructuredNumber(raw, ["power", "enginePower", "maxPower"]);
  return reasonable(generic, 20, 2500);
}

function structuredEngineCc(offer: Partial<VehicleOffer>) {
  const raw = offer.operational?.raw;
  const cc = findStructuredNumber(raw, [
    "engineCc", "engine_cc", "displacement", "engineDisplacement", "engine_displacement", "engineCapacity", "engine_capacity", "cc",
  ]);
  if (reasonable(cc, 300, 10_000)) return reasonable(cc, 300, 10_000);
  const liters = findStructuredNumber(raw, ["engineLiters", "engine_liters", "engineVolume", "engine_volume", "volumeLiters"]);
  return liters && liters <= 10 ? reasonable(liters * 1000, 300, 10_000) : undefined;
}

function normalizedCurrency(offer: Partial<VehicleOffer>) {
  const currency = String(offer.sourceCurrency || "").toUpperCase();
  const sourcePrice = Number(offer.sourcePrice || 0);
  if (offer.market === "japan" && currency === "USD" && sourcePrice > 250_000) return "JPY";
  return currency || offer.sourceCurrency;
}

export function normalizeVehicleOfferSpecs<T extends Partial<VehicleOffer>>(offer: T): T {
  const primary = primaryText(offer);
  const full = allText(offer);
  const engineCc = reasonable(offer.engineCc, 300, 10_000) || structuredEngineCc(offer) || inferEngineCc(primary) || inferEngineCc(full);
  const powerHp = reasonable(offer.powerHp, 20, 2500) || structuredPowerHp(offer) || inferPowerHp(primary) || inferPowerHp(full);
  const explicitPowerKw = reasonable(offer.powerKw, 10, 2000);
  const powerKw = explicitPowerKw || (powerHp ? Math.round(powerHp / 1.35962) : undefined);
  let fuel = inferFuel(primary) || offer.fuel || inferFuel(full.replace(/electric|battery electric|\bbev\b|\bev\b|электро|纯电|전기/g, " "));
  const strongElectric = /electric|battery electric|\bbev\b|\bev\b|электро|纯电|전기/.test(primary);
  if (engineCc && fuel === "electric" && !strongElectric) fuel = inferFuel(primary.replace(/electric|\bbev\b|\bev\b|электро/g, " ")) || "petrol";
  if (engineCc && fuel === "electric" && /diesel|tdi|crdi|d-4d|d4d|дизел/.test(primary)) fuel = "diesel";
  return {
    ...offer,
    sourceCurrency: normalizedCurrency(offer),
    fuel,
    transmission: inferTransmission(`${offer.transmission || ""} ${primary}`) || inferTransmission(full) || offer.transmission,
    drive: inferDrive(`${offer.drive || ""} ${primary}`) || inferDrive(full) || offer.drive,
    bodyType: inferBody(`${offer.bodyType || ""} ${primary}`) || inferBody(full) || offer.bodyType,
    engineCc,
    powerHp,
    powerKw,
  };
}
