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

export function canonicalOpenModel(titleInput: string, makeInput: string, fallbackModel = "") {
  const make = clean(makeInput);
  const title = removeLeadingMake(withoutLeadingYear(clean(titleInput)), make);
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
