import type { VehicleKnowledgeModel, VehicleKnowledgeVariant } from "./vehicle-knowledge";

function decodeHtml(value: string) {
  return value
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&ndash;|&#8211;/gi, "–")
    .replace(/&mdash;|&#8212;/gi, "—")
    .replace(/&laquo;|&#171;/gi, "«")
    .replace(/&raquo;|&#187;/gi, "»")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

export function dromHtmlToLines(html: string) {
  return decodeHtml(String(html || ""))
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:td|th)>/gi, "\t")
    .replace(/<\/(?:tr|h[1-6]|p|li|section|article)>/gi, "\n")
    .replace(/<\/(?:div)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .split(/\n+/)
    .map((line) => line.replace(/[ \f\v]+/g, " ").replace(/\s*\t\s*/g, "\t").trim())
    .filter(Boolean);
}

function number(value: unknown) {
  const parsed = Number(String(value || "").replace(",", "."));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function monthDate(value: string, end = false) {
  const match = String(value || "").match(/(\d{2})\.(\d{4})/);
  if (!match) return undefined;
  const month = Math.min(12, Math.max(1, Number(match[1])));
  const year = Number(match[2]);
  const day = end ? new Date(Date.UTC(year, month, 0)).getUTCDate() : 1;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function periodFromText(value: string) {
  const match = value.match(/(\d{2}\.\d{4})\s*[-–—]\s*(\d{2}\.\d{4}|н\.?\s*в\.?)/i);
  if (!match) return null;
  const from = monthDate(match[1]);
  const current = /н\.?\s*в\.?/i.test(match[2]);
  const to = current ? undefined : monthDate(match[2], true);
  return {
    productionFrom: from,
    productionTo: to,
    yearFrom: from ? Number(from.slice(0, 4)) : undefined,
    yearTo: to ? Number(to.slice(0, 4)) : undefined,
  };
}

function bodyType(value: string) {
  const text = value.toLowerCase();
  if (/джип|suv|кроссовер/.test(text)) return "suv";
  if (/седан/.test(text)) return "sedan";
  if (/хэтчбек/.test(text)) return "hatchback";
  if (/универсал/.test(text)) return "wagon";
  if (/минивэн|mpv/.test(text)) return "minivan";
  if (/купе/.test(text)) return "coupe";
  if (/кабриолет|родстер/.test(text)) return "convertible";
  if (/пикап/.test(text)) return "pickup";
  return undefined;
}

function fuel(value: string) {
  const text = value.toLowerCase();
  if (/электро/.test(text)) return "electric";
  if (/гибрид/.test(text)) return "hybrid";
  if (/дизел/.test(text)) return "diesel";
  if (/газ|lpg/.test(text)) return "lpg";
  if (/бензин/.test(text)) return "petrol";
  return undefined;
}

function transmission(value: string) {
  const text = value.toLowerCase();
  if (/вариатор|cvt/.test(text)) return "cvt";
  if (/робот|dct/.test(text)) return "dct";
  if (/мкпп|механик/.test(text)) return "manual";
  if (/акпп|автомат/.test(text)) return "automatic";
  return undefined;
}

function drive(value: string) {
  const text = value.toLowerCase();
  if (/полный|4wd|awd/.test(text)) return "awd";
  if (/задний|fr\b|rwd/.test(text)) return "rwd";
  if (/передний|ff\b|fwd/.test(text)) return "fwd";
  return undefined;
}

function generation(value: string) {
  const restyling = /рестайлинг/i.test(value);
  const match = value.match(/(\d+)\s*поколение/i);
  if (!match) return undefined;
  return `${match[1]} поколение${restyling ? ", рестайлинг" : ""}`;
}

function engineCode(value: string) {
  const columns = value.split("\t").map((part) => part.trim()).filter(Boolean);
  const candidates = columns.slice(1).flatMap((column) => column.match(/\b[A-Z][A-Z0-9-]{1,10}\b/g) || []);
  return candidates.find((candidate) => !/^(CVT|DCT|AWD|FWD|RWD|FF|FR|SUV)$/i.test(candidate));
}

function parseModification(line: string) {
  const hp = number(line.match(/(\d+(?:[.,]\d+)?)\s*л\.?\s*с\.?/i)?.[1]);
  const liters = number(line.match(/(\d+(?:[.,]\d+)?)\s*л(?:\.|,|\s)/i)?.[1]);
  if (!hp || !liters || !/(?:бензин|дизел|гибрид|электро|газ|lpg)/i.test(line)) return null;
  const explicitCc = [...line.matchAll(/(?:^|[\t\s])(\d{3,4})(?=[\t\s]|$)/g)]
    .map((match) => Number(match[1]))
    .find((value) => value >= 500 && value <= 9000);
  return {
    powerHp: hp,
    powerKw: Math.round((hp / 1.35962) * 100) / 100,
    engineCc: explicitCc || Math.round(liters * 1000),
    fuel: fuel(line),
    transmission: transmission(line),
    drive: drive(line),
    engineCode: engineCode(line),
    powertrainKind: /электро/i.test(line) ? "electric" as const : /гибрид/i.test(line) ? "other_hybrid" as const : "combustion" as const,
  };
}

export function parseDromVehicleVariants(
  html: string,
  model: VehicleKnowledgeModel,
  sourceUrl: string,
  verifiedAt = new Date().toISOString(),
): Array<Omit<VehicleKnowledgeVariant, "id"> & { engineCode?: string }> {
  const lines = dromHtmlToLines(html);
  const variants = [] as Array<Omit<VehicleKnowledgeVariant, "id"> & { engineCode?: string }>;
  let section = "";
  let period: ReturnType<typeof periodFromText> = null;

  for (const line of lines) {
    if (/^Двигатель\s+/i.test(line) && !/^Двигатель\s+[^,]+\s+технические/i.test(line)) {
      section = line;
      period = periodFromText(line);
      continue;
    }
    const detectedPeriod = periodFromText(line);
    if (detectedPeriod) {
      period = detectedPeriod;
      continue;
    }
    const modification = parseModification(line);
    if (!modification) continue;
    variants.push({
      modelId: model.id,
      make: model.make,
      model: model.model,
      generation: generation(section),
      yearFrom: period?.yearFrom,
      yearTo: period?.yearTo,
      productionFrom: period?.productionFrom,
      productionTo: period?.productionTo,
      engineCc: modification.engineCc,
      engineCcTolerance: 40,
      fuel: modification.fuel,
      transmission: modification.transmission,
      drive: modification.drive,
      bodyType: bodyType(section),
      powertrainKind: modification.powertrainKind,
      powerHp: modification.powerHp,
      powerKw: modification.powerKw,
      sourceType: "drom_catalog",
      sourceIds: ["drom_catalog"],
      sourceUrl,
      verifiedAt,
      active: true,
      engineCode: modification.engineCode,
    });
  }

  const unique = new Map<string, typeof variants[number]>();
  for (const variant of variants) {
    const key = [
      variant.generation || "",
      variant.productionFrom || "",
      variant.productionTo || "",
      variant.engineCc || "",
      variant.powerHp,
      variant.fuel || "",
      variant.transmission || "",
      variant.drive || "",
      variant.engineCode || "",
    ].join("|");
    if (!unique.has(key)) unique.set(key, variant);
  }
  return [...unique.values()];
}
