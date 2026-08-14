import { normalizeVehicleOfferSpecs } from "./spec-normalization";
import type { CatalogSourceAdapter, VehicleOffer } from "./types";

const CHASSIS_RE = /^[A-Z]{1,5}[A-Z0-9-]*\d{2,4}[A-Z0-9-]*$/i;
const SPEC_TOKEN_RE = /^(?:\d[\d,.]*|km|cc|cm3|cm³|hp|ps|kw|at|mt|cvt|dct|dsg|2wd|4wd|awd|fwd|rwd|right|left|petrol|gasoline|diesel|hybrid|electric|ev|bev|phev)$/i;
const MODEL_SUFFIXES = new Set(["series", "class", "cruiser", "rover", "cherokee", "santa", "sport", "touring", "wagon", "cross", "countryman"]);
const MULTIWORD_MODELS = [
  "Land Cruiser Prado", "Land Cruiser", "Range Rover Sport", "Range Rover Evoque", "Range Rover",
  "Grand Cherokee", "Grand Vitara", "Grand Santa Fe", "Santa Fe", "Crown Athlete", "Crown Majesta",
  "Corolla Cross", "Corolla Touring", "Prius Alpha", "Mark II", "Model 3", "Model Y", "Model S", "Model X",
  "3 Series", "5 Series", "7 Series", "A-Class", "B-Class", "C-Class", "E-Class", "S-Class", "GLA Class", "GLC Class", "GLE Class", "GLS Class",
];

function clean(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function withoutLeadingYear(value: string) {
  return value.replace(/^(?:(?:19|20)\d{2}(?:\/\d+)?|\d{1,2}\/\d{4})\s+/, "").trim();
}

function removeLeadingMake(value: string, make: string) {
  const source = clean(value);
  const prefix = clean(make);
  if (!source || !prefix) return source;
  return source.toLocaleLowerCase("en-US").startsWith(`${prefix.toLocaleLowerCase("en-US")} `)
    ? source.slice(prefix.length).trim()
    : source;
}

function rawTitle(raw: any, offer: VehicleOffer) {
  return clean(raw?.title || raw?.name || raw?.vehicleName || raw?.carName || offer.trim || `${offer.make} ${offer.model}`);
}

const MERCEDES_CLASS_BY_LETTER: Record<string, string> = {
  A: "A-Class", B: "B-Class", C: "C-Class", E: "E-Class", G: "G-Class", S: "S-Class", V: "V-Class",
};
const MERCEDES_CODE_MODELS: Record<string, string> = {
  GLA: "GLA Class", GLB: "GLB Class", GLC: "GLC Class", GLE: "GLE Class", GLS: "GLS Class",
  CLA: "CLA", CLS: "CLS", EQA: "EQA", EQB: "EQB", EQC: "EQC", EQE: "EQE", EQS: "EQS", EQV: "EQV",
  VITO: "Vito", SPRINTER: "Sprinter", CITAN: "Citan", SL: "SL", SLC: "SLC", SLK: "SLK",
};

function canonicalMercedesModel(titleInput: string, makeInput: string, fallbackModel = "") {
  const make = clean(makeInput);
  const fallback = clean(fallbackModel);
  let title = withoutLeadingYear(clean(titleInput)).replace(/[‐‑‒–—]/g, "-");
  const mercedesContext = /mercedes|benz/i.test(make)
    || /^(?:mercedes(?:[-\s]+benz)?|benz)\b/i.test(title)
    || /^(?:benz|mercedes(?:-benz)?)$/i.test(fallback);
  if (!mercedesContext) return "";

  title = title
    .replace(/^mercedes(?:[-\s]+benz)?\s+/i, "")
    .replace(/^benz\s+/i, "")
    .trim()
    .replace(/^(?:ALLRAD|4MATIC)\s+/i, "")
    .trim();

  let match = title.match(/^(?:class|klasse|klasa|classe|clase)\s*([ABCEGSV])\b/i)
    || title.match(/^([ABCEGSV])[-\s]?(?:class|klasse|klasa|classe|clase)\b/i);
  if (match?.[1]) return MERCEDES_CLASS_BY_LETTER[match[1].toUpperCase()] || "";

  match = title.match(/^(GLA|GLB|GLC|GLE|GLS|CLA|CLS|EQA|EQB|EQC|EQE|EQS|EQV|VITO|SPRINTER|CITAN|SLC|SLK|SL)\b/i);
  if (match?.[1]) return MERCEDES_CODE_MODELS[match[1].toUpperCase()] || "";

  match = title.match(/^(AMG\s+(?:GT|SL))\b/i);
  if (match?.[1]) return match[1].toUpperCase().replace(/\s+/g, " ");
  if (/^Marco\s+Polo\b/i.test(title)) return "Marco Polo";

  match = title.match(/^([ABCEGSV])\s+(?=\d{2,3}(?:\s*[a-z]{1,2})?\b)/i);
  if (match?.[1]) return MERCEDES_CLASS_BY_LETTER[match[1].toUpperCase()] || "";

  return "";
}

export function canonicalSourceModelIdentity(titleInput: string, makeInput: string, fallbackModel = "") {
  return canonicalMercedesModel(titleInput, makeInput, fallbackModel) || clean(fallbackModel);
}

export function canonicalOpenModel(titleInput: string, makeInput: string, fallbackModel = "") {
  const make = clean(makeInput);
  const rawTitle = withoutLeadingYear(clean(titleInput));
  const sourceIdentity = canonicalMercedesModel(rawTitle, make, fallbackModel);
  if (sourceIdentity) return sourceIdentity;
  const title = removeLeadingMake(rawTitle, make);
  if (!title) return clean(fallbackModel);

  const matchingPhrase = MULTIWORD_MODELS
    .filter((phrase) => title.toLocaleLowerCase("en-US").startsWith(phrase.toLocaleLowerCase("en-US")))
    .sort((left, right) => right.length - left.length)[0];
  if (matchingPhrase) return matchingPhrase;

  const tokens = title.split(/\s+/).filter(Boolean);
  if (!tokens.length) return clean(fallbackModel);
  const modelTokens: string[] = [];
  for (const token of tokens) {
    if (modelTokens.length && (CHASSIS_RE.test(token) || SPEC_TOKEN_RE.test(token) || /^(?:save|price|ref|stock)$/i.test(token))) break;
    modelTokens.push(token);
    if (modelTokens.length === 1 && MODEL_SUFFIXES.has(String(tokens[1] || "").toLocaleLowerCase("en-US"))) continue;
    if (modelTokens.length >= 2 || (modelTokens.length === 1 && !MODEL_SUFFIXES.has(String(tokens[1] || "").toLocaleLowerCase("en-US")))) break;
  }
  return clean(modelTokens.join(" ")) || clean(fallbackModel);
}

export function normalizeOpenSource<T extends CatalogSourceAdapter>(source: T): T {
  if (!source.sourceId.endsWith("_open")) return source;
  const originalNormalize = source.normalizeOffer.bind(source);
  source.normalizeOffer = (raw: unknown) => {
    const offer = originalNormalize(raw);
    if (!offer) return null;

    if (offer.catalogKind === "auction_result") return normalizeVehicleOfferSpecs(offer) as VehicleOffer;

    const title = rawTitle(raw as any, offer);
    const model = canonicalOpenModel(title, offer.make, offer.model);
    if (!model) return null;
    const normalized = normalizeVehicleOfferSpecs({
      ...offer,
      model,
      trim: title || offer.trim,
      operational: {
        ...offer.operational,
        raw: {
          ...((offer.operational?.raw && typeof offer.operational.raw === "object") ? offer.operational.raw as object : {}),
          normalizedCatalogModel: model,
          originalCatalogTitle: title,
        },
      },
    }) as VehicleOffer;
    return normalized;
  };
  return source;
}
