import type { VehicleOffer } from "./types";

const HYBRID_PRIMARY_RE = /series[ -]?hybrid|range[ -]?extender|\b(?:hybrid|reev|erev|phev|hev|mhev)\b|plug[ -]?in|parallel[ -]?hybrid|power[ -]?split|mixed[ -]?hybrid|гибрид|混合动力|增程|하이브리드/i;
const SERIES_HYBRID_PRIMARY_RE = /series[ -]?hybrid|range[ -]?extender|\b(?:reev|erev)\b|\be[ -]?power\b|последовательн\w*\s+гибрид|增程/i;
const ELECTRIC_PRIMARY_RE = /battery[ -]?electric|pure[ -]?electric|\b(?:bev|ev)\b|электромоб|электро(?:кар|мобиль)|纯电|전기차|일렉트릭/i;
const COMBUSTION_FUELS = new Set(["petrol", "diesel", "lpg", "gasoline", "benzin"]);

function positive(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
function text(value: unknown) { return String(value || "").trim().toLocaleLowerCase("en-US"); }
function fuel(value: unknown) {
  const v=text(value); if(!v) return undefined;
  if (/\b(?:phev|hev|mhev|reev|erev)\b|plug[ -]?in|hybrid|гибрид|混合动力|增程|하이브리드/.test(v)) return "hybrid";
  if (/diesel|дизел|柴油|디젤|경유/.test(v)) return "diesel";
  if (/\b(?:lpg|lpi|cng|gpl)\b|газ/.test(v)) return "lpg";
  if (/petrol|gasoline|benzin|essence|бензин|汽油|가솔린|휘발유/.test(v)) return "petrol";
  if (/electric|\bbev\b|\bev\b|электро|纯电|전기|일렉트릭/.test(v)) return "electric";
  return undefined;
}
function transmission(value: unknown) {
  const v=text(value); if(!v) return undefined;
  if (/cvt|e-cvt|ecvt|xtronic|вариатор|无级变速/.test(v)) return "cvt";
  if (/dct|dsg|pdk|dual clutch|робот|双离合/.test(v)) return "dct";
  if (/manual|\bmt\b|механик|手动|수동/.test(v)) return "manual";
  if (/automatic|automatik|\bauto\b|a\/t|\bat\b|автомат|手自一体|自动挡?|오토|자동/.test(v)) return "automatic";
  return undefined;
}
function drive(value: unknown) {
  const v=text(value); if(!v) return undefined;
  if (/\b(?:awd|4wd|4x4)\b|all[ -]?wheel|four[ -]?wheel|полный привод|四驱|사륜|4륜/.test(v)) return "awd";
  if (/\brwd\b|rear[ -]?wheel|задний привод|后驱|후륜/.test(v)) return "rwd";
  if (/\bfwd\b|front[ -]?wheel|\b2wd\b|передний привод|前驱|两驱|전륜/.test(v)) return "fwd";
  return undefined;
}
function body(value: unknown) {
  const v=text(value); if(!v) return undefined;
  if (/pickup|pick-up|пикап|皮卡/.test(v)) return "pickup";
  if (/minivan|\bmpv\b|минивэн|미니밴/.test(v)) return "minivan";
  if (/panel van|cargo van|commercial van|^van$|фургон/.test(v)) return "van";
  if (/convertible|cabrio|roadster|кабриолет/.test(v)) return "convertible";
  if (/coupe|coupé|купе|쿠페/.test(v)) return "coupe";
  if (/wagon|estate|touring|универсал|旅行车|왜건/.test(v)) return "wagon";
  if (/hatchback|hatch|fastback|хэтчбек|两厢|해치백/.test(v)) return "hatchback";
  if (/sedan|saloon|limousine|седан|轿车|三厢|세단/.test(v)) return "sedan";
  if (/off[ -]?road|внедорожник|越野车/.test(v)) return "offroad";
  if (/suv|crossover|кроссовер/.test(v)) return "suv";
  return undefined;
}

export function canonicalizeSemanticSourceFields<T extends Partial<VehicleOffer>>(input:T):T {
  return {...input, fuel:fuel(input.fuel), transmission:transmission(input.transmission), drive:drive(input.drive), bodyType:body(input.bodyType)} as T;
}

/**
 * Resolve an explicitly named electrified powertrain only from identity-bound
 * top-level fields. Raw marketplace payloads are deliberately excluded: they
 * frequently contain menus and recommendations for unrelated vehicles.
 */
export function namedElectrifiedPowertrainKind(input: Partial<VehicleOffer>) {
  const primary=[input.make,input.model,input.generation,input.trim,input.engineType,input.fuel].filter(Boolean).join(" ");
  if (SERIES_HYBRID_PRIMARY_RE.test(primary)) return "series_hybrid" as const;
  if (HYBRID_PRIMARY_RE.test(primary)) return "other_hybrid" as const;
  if (ELECTRIC_PRIMARY_RE.test(primary)) return "electric" as const;
  return undefined;
}

export function preferExplicitCombustionPowertrain<T extends Partial<VehicleOffer>>(input: T): T {
  const canonical=canonicalizeSemanticSourceFields(input);
  const namedKind=namedElectrifiedPowertrainKind(canonical);
  if (namedKind) {
    const correctedFromCombustion=canonical.powertrainKind === "combustion";
    const raw=typeof canonical.operational?.raw === "object" && canonical.operational.raw ? canonical.operational.raw as object : {};
    return {
      ...canonical,
      fuel:namedKind === "electric" ? "electric" : "hybrid",
      powertrainKind:namedKind,
      engineCc:namedKind === "electric" ? undefined : canonical.engineCc,
      icePowerKw:correctedFromCombustion || namedKind === "electric" ? undefined : canonical.icePowerKw,
      utilizationPowerKw:correctedFromCombustion ? undefined : canonical.utilizationPowerKw,
      operational:{...canonical.operational,raw:{...raw,powertrainSafety:{correctedTo:namedKind,reason:"identity_bound_electrified_name"}}},
    } as T;
  }
  const canonicalFuel=String(canonical.fuel||"");
  const engineCc=positive(canonical.engineCc);
  if ((canonical.powertrainKind === "electric" || canonicalFuel === "electric") && engineCc) {
    return {...canonical,engineCc:undefined,icePowerKw:undefined,operational:{...canonical.operational,raw:{...(typeof canonical.operational?.raw === "object" && canonical.operational.raw ? canonical.operational.raw as object : {}),powertrainSafety:{correctedTo:"electric",reason:"electric_powertrain_cannot_have_engine_displacement",removedEngineCc:engineCc}}}} as T;
  }
  if (!engineCc || !COMBUSTION_FUELS.has(canonicalFuel)) return canonical;
  const powerKw=positive(canonical.icePowerKw)||positive(canonical.powerKw)||(positive(canonical.powerHp)?Math.round((Number(canonical.powerHp)/1.35962)*100)/100:undefined);
  return {...canonical,powertrainKind:"combustion",icePowerKw:positive(canonical.icePowerKw)||powerKw,power30MinKw:undefined,power30MinKwByMotor:undefined,utilizationPowerKw:powerKw,operational:{...canonical.operational,raw:{...(typeof canonical.operational?.raw === "object" && canonical.operational.raw ? canonical.operational.raw as object : {}),powertrainSafety:{correctedTo:"combustion",reason:"explicit_combustion_fuel_and_engine"}}}} as T;
}
