import type { PowerDataConfidence, PowertrainKind, VehicleOffer } from "./types";
import { catalogPowerSanity } from "./power-sanity";
import { namedElectrifiedPowertrainKind } from "./powertrain-safety";

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
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function allText(offer: Partial<VehicleOffer>) {
  return `${primaryText(offer)} ${rawText(offer.operational?.raw)}`.replace(/\s+/g, " ").toLowerCase();
}

function reasonable(value: unknown, min: number, max: number) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max
    ? Math.round(number * 100) / 100
    : undefined;
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

function scalarNumbers(value: unknown) {
  if (Array.isArray(value)) return value.map(scalarNumber).filter((item): item is number => item !== undefined);
  if (typeof value === "number") return Number.isFinite(value) ? [value] : [];
  if (typeof value !== "string") return [];
  return [...value.replace(/,/g, ".").matchAll(/-?\d+(?:\.\d+)?/g)]
    .map((match) => Number(match[0]))
    .filter(Number.isFinite);
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

function findStructuredNumbers(value: unknown, keys: string[], depth = 0): number[] {
  if (value == null || depth > 10 || typeof value !== "object") return [];
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findStructuredNumbers(item, keys, depth + 1);
      if (found.length) return found;
    }
    return [];
  }

  const wanted = new Set(keys.map(normalizedKey));
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (!wanted.has(normalizedKey(key))) continue;
    const parsed = scalarNumbers(item).filter((number) => number >= 1 && number <= 2_000);
    if (parsed.length) return parsed;
  }
  for (const item of Object.values(value as Record<string, unknown>)) {
    const found = findStructuredNumbers(item, keys, depth + 1);
    if (found.length) return found;
  }
  return [];
}

function inferFuel(text: string) {
  if (/\b(?:phev|hev|mhev|reev|erev)\b|plug[ -]?in|hybrid|\be[- ]?power\b|range extender|гибрид|混合动力|增程|하이브리드/.test(text)) return "hybrid";
  if (/diesel|tdi|crdi|d-4d|d4d|bluehdi|dci|hdi|дизел|柴油|디젤/.test(text)) return "diesel";
  if (/lpg|cng|gpl|газ/.test(text)) return "lpg";
  if (/petrol|gasoline|benzin|essence|gdi|mpi|tgdi|tsi|tfsi|бензин|汽油|가솔린/.test(text)) return "petrol";
  if (/electric|battery electric|\bbev\b|\bev\b|электро|纯电|전기|일렉트릭/.test(text)) return "electric";
  return undefined;
}

function inferPowertrainKind(text: string, engineCc?: number): PowertrainKind {
  if (/series[ -]?hybrid|range[ -]?extender|\be[- ]?power\b|\b(?:reev|erev)\b|последовательн\w*\s+гибрид|增程/.test(text)) return "series_hybrid";
  if (/plug[ -]?in|\b(?:phev|hev|mhev)\b|parallel[ -]?hybrid|power[ -]?split|mixed[ -]?hybrid|гибрид|hybrid|混合动力|하이브리드/.test(text)) return "other_hybrid";
  if (/battery[ -]?electric|pure[ -]?electric|\bbev\b|\bev\b|электромоб|纯电|전기차|일렉트릭/.test(text) && !engineCc) return "electric";
  if (engineCc || /petrol|gasoline|diesel|бензин|дизел|汽油|柴油|가솔린|디젤/.test(text)) return "combustion";
  return "unknown";
}

function inferTransmission(text: string) {
  if (/cvt|e-cvt|ecvt|xtronic|вариатор|无级变速/.test(text)) return "cvt";
  if (/dct|dsg|pdk|dual clutch|робот|双离合/.test(text)) return "dct";
  if (/manual|\bmt\b|stick shift|механик|手动|수동/.test(text)) return "manual";
  if (/automatic|automatik|\bauto\b|a\/t|\bat\b|автомат|手自一体|自动挡?|오토|자동/.test(text)) return "automatic";
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
  if (/wagon|estate|touring|\bavant\b|универсал|旅行车/.test(text)) return "wagon";
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
  return liters ? reasonable(Number(liters[1].replace(",", ".")) * 1_000, 300, 10_000) : undefined;
}

function inferPowerHp(text: string) {
  const hp = text.match(/\b([2-9]\d|[1-9]\d{2}|1\d{3})\s*(?:hp|ps|bhp|cv|ch|л\.?\s*с\.?|лс|马力|匹|마력|ცხ\.?\s*ძ\.?)(?=$|[^\p{L}\p{N}])/iu);
  if (hp) return reasonable(hp[1], 20, 2_500);
  const georgian = text.match(/\b([2-9]\d|[1-9]\d{2}|1\d{3})\s*ცხენის\s+ძალა/i);
  if (georgian) return reasonable(georgian[1], 20, 2_500);
  const kw = text.match(/\b([1-9]\d{1,3})\s*(?:kw|квт|კვტ|千瓦|킬로와트)(?=$|[^\p{L}\p{N}])/iu);
  return kw ? reasonable(Number(kw[1]) * 1.35962, 20, 2_500) : undefined;
}

function suspiciousMashinaNumericModelPower(offer: Partial<VehicleOffer>, powerHp?: number) {
  if (String(offer.sourceId || "") !== "mashina_kyrgyzstan_exact" || !powerHp) return false;
  const numericModelTokens = String(offer.model || "").match(/\b\d{2,4}\b/g) || [];
  if (!numericModelTokens.some((token) => Number(token) === Math.round(powerHp))) return false;
  const raw = rawText(offer.operational?.raw);
  const rawExplicitPower = inferPowerHp(raw);
  const confidence = String(offer.powerDataConfidence || "");
  return rawExplicitPower === undefined && !["documented", "source_exact"].includes(confidence);
}

function structuredPowerHp(offer: Partial<VehicleOffer>) {
  const raw = offer.operational?.raw;
  const hp = findStructuredNumber(raw, [
    "powerHp", "power_hp", "horsePower", "horse_power", "horsepower", "enginePowerHp", "maxPowerHp", "hp", "ps", "cv",
  ]);
  if (reasonable(hp, 20, 2_500)) return reasonable(hp, 20, 2_500);
  const kw = findStructuredNumber(raw, [
    "powerKw", "power_kw", "enginePowerKw", "engine_power_kw", "motorPowerKw", "maxPowerKw", "kw",
  ]);
  if (reasonable(kw, 10, 2_000)) return reasonable(Number(kw) * 1.35962, 20, 2_500);
  const generic = findStructuredNumber(raw, ["power", "enginePower", "maxPower"]);
  return reasonable(generic, 20, 2_500);
}

function structuredEngineCc(offer: Partial<VehicleOffer>) {
  const raw = offer.operational?.raw;
  const cc = findStructuredNumber(raw, [
    "engineCc", "engine_cc", "displacement", "engineDisplacement", "engine_displacement", "engineCapacity", "engine_capacity", "cc",
  ]);
  if (reasonable(cc, 300, 10_000)) return reasonable(cc, 300, 10_000);
  const liters = findStructuredNumber(raw, ["engineLiters", "engine_liters", "engineVolume", "engine_volume", "volumeLiters"]);
  return liters && liters <= 10 ? reasonable(liters * 1_000, 300, 10_000) : undefined;
}

const POWER_30_MIN_TOTAL_KEYS = [
  "power30MinKw", "power_30_min_kw", "maximum30MinutePowerKw", "max30MinutePowerKw", "thirtyMinutePowerKw",
  "electricMotor30MinPowerKw", "motor30MinPowerKw", "max30MinPower", "最大30分钟功率", "30分钟最大功率",
];
const POWER_30_MIN_MOTOR_KEYS = [
  "power30MinKwByMotor", "power_30_min_kw_by_motor", "motor30MinPowersKw", "motors30MinutePowerKw",
  "electricMotors30MinPowerKw", "tractionMotor30MinPowersKw", "驱动电机30分钟功率",
];

function inferThirtyMinutePowers(text: string) {
  const values: number[] = [];
  const label = String.raw`(?:(?:maximum\s+)?30[\s-]?(?:minute|min)(?:\s+power)?|30\s*мин(?:ут\w*)?(?:\s+мощност\w*)?|最大\s*30\s*分钟(?:功率)?|30\s*分钟(?:最大)?功率|30\s*분(?:\s*최대)?(?:\s*출력)?)`;
  const unit = String.raw`(?:kw|квт|კვტ|千瓦|킬로와트)`;
  const patterns = [
    new RegExp(String.raw`${label}[^0-9]{0,50}([0-9]+(?:[.,][0-9]+)?)\s*${unit}`, "gi"),
    new RegExp(String.raw`([0-9]+(?:[.,][0-9]+)?)\s*${unit}[^.;|]{0,45}${label}`, "gi"),
  ];

  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const parsed = reasonable(Number(String(match[1]).replace(",", ".")), 1, 2_000);
      if (parsed !== undefined) values.push(parsed);
    }
    if (values.length) break;
  }
  return values;
}

function exactThirtyMinutePowers(offer: Partial<VehicleOffer>, fullText: string) {
  const explicitMotors = (offer.power30MinKwByMotor || [])
    .map((value) => reasonable(value, 1, 2_000))
    .filter((value): value is number => value !== undefined);
  if (explicitMotors.length) {
    return {
      values: explicitMotors,
      confidence: "documented" as PowerDataConfidence,
      source: offer.powerDataSource || "offer.power30MinKwByMotor",
    };
  }

  const explicitTotal = reasonable(offer.power30MinKw, 1, 2_000);
  if (explicitTotal !== undefined) {
    return {
      values: [explicitTotal],
      confidence: "documented" as PowerDataConfidence,
      source: offer.powerDataSource || "offer.power30MinKw",
    };
  }

  const structuredMotors = findStructuredNumbers(offer.operational?.raw, POWER_30_MIN_MOTOR_KEYS);
  if (structuredMotors.length) {
    return {
      values: structuredMotors,
      confidence: "source_exact" as PowerDataConfidence,
      source: "source:30-minute-power-by-motor",
    };
  }

  const structuredTotal = reasonable(
    findStructuredNumber(offer.operational?.raw, POWER_30_MIN_TOTAL_KEYS),
    1,
    2_000,
  );
  if (structuredTotal !== undefined) {
    return {
      values: [structuredTotal],
      confidence: "source_exact" as PowerDataConfidence,
      source: "source:30-minute-power",
    };
  }

  const fromText = inferThirtyMinutePowers(fullText);
  if (fromText.length) {
    return {
      values: fromText,
      confidence: "source_exact" as PowerDataConfidence,
      source: "source-text:30-minute-power",
    };
  }

  return {
    values: [] as number[],
    confidence: offer.powerDataConfidence,
    source: offer.powerDataSource,
  };
}

function exactIcePowerKw(offer: Partial<VehicleOffer>, fullText: string, kind: PowertrainKind, genericPowerKw?: number) {
  const explicit = reasonable(offer.icePowerKw, 5, 2_000);
  if (explicit !== undefined) return explicit;
  const structured = reasonable(findStructuredNumber(offer.operational?.raw, [
    "icePowerKw", "ice_power_kw", "combustionEnginePowerKw", "engineOnlyPowerKw", "internalCombustionPowerKw", "发动机功率kw",
  ]), 5, 2_000);
  if (structured !== undefined) return structured;
  const match = fullText.match(/(?:ice|combustion engine|internal combustion|двс|двигател[ья]\s+внутреннего\s+сгорания|发动机)[^0-9]{0,45}([0-9]+(?:[.,][0-9]+)?)\s*(?:kw|квт|千瓦)/i);
  const fromText = match ? reasonable(Number(match[1].replace(",", ".")), 5, 2_000) : undefined;
  if (fromText !== undefined) return fromText;
  return kind === "combustion" ? genericPowerKw : undefined;
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
  const explicitEngineCc = reasonable(offer.engineCc, 300, 10_000);
  const engineCc = explicitEngineCc
    || structuredEngineCc(offer)
    || inferEngineCc(primary)
    || inferEngineCc(full);
  const suppliedPowerHp = reasonable(offer.powerHp, 20, 2_500);
  const rejectNumericModelPower = suspiciousMashinaNumericModelPower(offer, suppliedPowerHp);
  const candidatePowerHp = rejectNumericModelPower
    ? inferPowerHp(primary) || inferPowerHp(full)
    : suppliedPowerHp || structuredPowerHp(offer) || inferPowerHp(primary) || inferPowerHp(full);
  const namedPowertrainKind = namedElectrifiedPowertrainKind(offer);
  const correctedFromCombustion = Boolean(namedPowertrainKind && offer.powertrainKind === "combustion");
  // Keep the supplied classification visible to the safety check. Replacing it
  // with the identity-derived kind here used to hide the very conflict we were
  // trying to detect (for example an Encar UX250h stored as combustion).
  const powerSanity = catalogPowerSanity({ ...offer, engineCc }, candidatePowerHp);
  const powerHp = powerSanity.suspicious ? undefined : candidatePowerHp;
  // If horsepower was rejected, do not retain a previously derived kW value
  // from the same bad marketplace number. Verified V2/official knowledge may
  // repopulate both fields after this normalization pass.
  const explicitPowerKw = rejectNumericModelPower || powerSanity.suspicious ? undefined : reasonable(offer.powerKw, 10, 2_000);
  const powerKw = explicitPowerKw || (powerHp ? Math.round((powerHp / 1.35962) * 100) / 100 : undefined);

  // Semantic vehicle attributes are provenance-sensitive. They may only be
  // normalized from the corresponding source field (plus engineType for fuel /
  // powertrain wording). Raw page payloads can contain filters, menus and
  // recommended vehicles and therefore are never evidence for these fields.
  const semanticPowertrainText = [offer.model, offer.generation, offer.trim, offer.fuel, offer.engineType]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .toLowerCase();
  let fuel = inferFuel(semanticPowertrainText) || offer.fuel;
  const explicitPowertrainKind = offer.powertrainKind && offer.powertrainKind !== "unknown" ? offer.powertrainKind : undefined;
  const scopedPowertrainKind = fuel === "electric"
    ? "electric"
    : inferPowertrainKind(semanticPowertrainText, explicitEngineCc);
  const powertrainKind = namedPowertrainKind || explicitPowertrainKind || scopedPowertrainKind;
  if (powertrainKind === "electric") fuel = "electric";
  else if (["series_hybrid", "other_hybrid"].includes(powertrainKind)) fuel = "hybrid";

  const thirtyMinute = exactThirtyMinutePowers(offer, full);
  const power30MinKwByMotor = thirtyMinute.values.length ? thirtyMinute.values : undefined;
  const power30MinKw = power30MinKwByMotor?.length
    ? Math.round(power30MinKwByMotor.reduce((sum, value) => sum + value, 0) * 100) / 100
    : undefined;
  const icePowerKw = correctedFromCombustion ? undefined : exactIcePowerKw(offer, full, powertrainKind, powerKw);
  const utilizationPowerKw = (correctedFromCombustion ? undefined : reasonable(offer.utilizationPowerKw, 1, 4_000))
    || (powertrainKind === "electric" || powertrainKind === "series_hybrid"
      ? power30MinKw
      : powertrainKind === "other_hybrid" && icePowerKw && power30MinKw
        ? Math.round((icePowerKw + power30MinKw) * 100) / 100
        : powertrainKind === "combustion"
          ? icePowerKw || powerKw
          : undefined);

  return {
    ...offer,
    operational: powerSanity.suspicious ? {
      ...(offer.operational || {}),
      powerSanity: { rejected: true, reason: powerSanity.reason, rejectedPowerHp: candidatePowerHp || null },
    } : offer.operational,
    sourceCurrency: normalizedCurrency(offer),
    fuel,
    powertrainKind,
    transmission: inferTransmission(String(offer.transmission || "").toLowerCase()) || offer.transmission,
    drive: inferDrive(String(offer.drive || "").toLowerCase()) || offer.drive,
    bodyType: inferBody(String(offer.bodyType || "").toLowerCase()) || offer.bodyType,
    engineCc,
    powerHp,
    powerKw,
    icePowerKw,
    power30MinKw,
    power30MinKwByMotor,
    utilizationPowerKw,
    powerDataConfidence: thirtyMinute.confidence || offer.powerDataConfidence || (powerKw ? "estimated" : undefined),
    powerDataSource: thirtyMinute.source || offer.powerDataSource,
  } as T;
}
