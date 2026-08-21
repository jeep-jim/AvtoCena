import { readBundledChunkedDataJson, readBundledDataJson } from "../bundled-data";
import type { PowerDataConfidence, PowertrainKind, VehicleOffer } from "./types";

export type VehicleKnowledgeModel = {
  id: string;
  make: string;
  model: string;
  makeAliases?: string[];
  aliases?: string[];
  bodyTypes?: string[];
  countries?: string[];
  regions?: string[];
  popularityDecile?: number;
  yearFrom?: number;
  yearTo?: number;
  representativePowerHp?: number;
  source: "vehiclesdb" | "drom" | "manufacturer" | "manual";
  sourceVersion?: string;
  sourceUrl?: string;
  updatedAt: string;
  active?: boolean;
};

export type VehicleKnowledgeVariant = {
  id: string;
  modelId: string;
  make: string;
  model: string;
  generation?: string;
  generationAliases?: string[];
  trimContains?: string[];
  yearFrom?: number;
  yearTo?: number;
  productionFrom?: string;
  productionTo?: string;
  engineCc?: number;
  engineCcTolerance?: number;
  fuel?: string;
  transmission?: string;
  drive?: string;
  bodyType?: string;
  powertrainKind?: Exclude<PowertrainKind, "unknown">;
  powerHp: number;
  powerKw?: number;
  icePowerKw?: number;
  power30MinKw?: number;
  power30MinKwByMotor?: number[];
  utilizationPowerKw?: number;
  sourceType: "manufacturer" | "official_registry" | "drom_catalog" | "source_consensus" | "manual";
  sourceIds?: string[];
  sourceUrl?: string;
  verifiedAt: string;
  active?: boolean;
};

export type VehicleModelMatch = {
  model: VehicleKnowledgeModel;
  score: number;
  matchedBy: "model" | "alias" | "text";
};

export type KnowledgePowerResolution = {
  powerHp?: number;
  confidence?: PowerDataConfidence;
  source?: string;
  usedVariant: boolean;
  usedRepresentative: boolean;
  conflict?: {
    kind: "variant_override" | "unresolved_model_conflict";
    suppliedPowerHp: number;
    referencePowerHp: number;
  };
};

const MODELS_PATH = "catalog/vehicle-knowledge/models.json";
const VARIANTS_PATH = "catalog/vehicle-knowledge/variants.json";
const V2_BRIDGE_MODELS_PATH = "catalog/vehicle-knowledge/v2-bridge-models.json";
const V2_BRIDGE_VARIANTS_PATH = "catalog/vehicle-knowledge/v2-bridge-variants.json";
let modelCache: Promise<VehicleKnowledgeModel[]> | null = null;
let variantCache: Promise<VehicleKnowledgeVariant[]> | null = null;

function text(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function vehicleKnowledgeToken(value: unknown) {
  return text(value)
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function vehicleKnowledgeCompact(value: unknown) {
  return vehicleKnowledgeToken(value).replace(/\s+/g, "");
}

function validName(value: unknown, minimum = 2) {
  const clean = text(value);
  return clean.length >= minimum
    && clean.length <= 48
    && /[\p{L}\p{N}]/u.test(clean)
    && !/^\[?object object\]?$/i.test(clean);
}

function positive(value: unknown, max = 4_000) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= max ? parsed : undefined;
}

function materiallyDifferent(left?: number, right?: number, relativeThreshold = 0.18, absoluteThreshold = 20) {
  if (!left || !right) return false;
  const delta = Math.abs(left - right);
  return delta >= absoluteThreshold && delta / Math.max(left, right) >= relativeThreshold;
}

export function resolveKnowledgePower(args: {
  suppliedPowerHp?: number;
  suppliedConfidence?: PowerDataConfidence;
  suppliedSource?: string;
  variantPowerHp?: number;
  variantId?: string;
  representativePowerHp?: number;
  modelId: string;
}): KnowledgePowerResolution {
  const supplied = positive(args.suppliedPowerHp, 2_500);
  const variant = positive(args.variantPowerHp, 2_500);
  const representative = positive(args.representativePowerHp, 2_500);
  const trustedSupplied = supplied && ["documented", "source_exact"].includes(String(args.suppliedConfidence || ""));

  if (!supplied) {
    if (variant) return {
      powerHp: variant,
      confidence: "reference",
      source: args.variantId ? `vehicle-knowledge:${args.variantId}` : undefined,
      usedVariant: true,
      usedRepresentative: false,
    };
    if (representative) return {
      powerHp: representative,
      confidence: "estimated",
      source: `vehicle-model-representative:${args.modelId}`,
      usedVariant: false,
      usedRepresentative: true,
    };
    return { usedVariant: false, usedRepresentative: false };
  }

  if (!trustedSupplied && variant && materiallyDifferent(supplied, variant)) {
    return {
      powerHp: variant,
      confidence: "reference",
      source: args.variantId ? `vehicle-knowledge:${args.variantId}` : undefined,
      usedVariant: true,
      usedRepresentative: false,
      conflict: { kind: "variant_override", suppliedPowerHp: supplied, referencePowerHp: variant },
    };
  }

  // A model-wide representative value is never safe enough to replace an exact
  // source field. It is only a plausibility alarm: if an untrusted source value
  // is wildly outside the model family and no unique variant can resolve it,
  // publish no horsepower rather than a confidently wrong number.
  if (!trustedSupplied && !variant && representative && materiallyDifferent(supplied, representative, 0.35, 30)) {
    return {
      usedVariant: false,
      usedRepresentative: false,
      conflict: { kind: "unresolved_model_conflict", suppliedPowerHp: supplied, referencePowerHp: representative },
    };
  }

  return {
    powerHp: supplied,
    confidence: args.suppliedConfidence,
    source: args.suppliedSource,
    usedVariant: false,
    usedRepresentative: false,
  };
}

function unique(values: unknown[]) {
  return [...new Set(values.map(text).filter(Boolean))];
}

function splitAliases(value: unknown) {
  if (Array.isArray(value)) return unique(value);
  return unique(String(value || "").split(/[|;,]/));
}

function modelSearchValues(model: VehicleKnowledgeModel) {
  return unique([model.model, ...(model.aliases || [])]);
}

function makeSearchValues(model: VehicleKnowledgeModel) {
  return unique([model.make, ...(model.makeAliases || [])]);
}

function boundaryIncludes(haystack: string, needle: string) {
  if (!haystack || !needle) return false;
  return ` ${haystack} `.includes(` ${needle} `);
}

function makeMatches(model: VehicleKnowledgeModel, rawMake: unknown, combined: string) {
  const requested = vehicleKnowledgeCompact(rawMake);
  const aliases = makeSearchValues(model).map(vehicleKnowledgeCompact).filter(Boolean);
  if (requested) return aliases.includes(requested);
  return aliases.some((alias) => boundaryIncludes(combined, vehicleKnowledgeToken(alias)) || combined.includes(alias));
}

function scoreModel(model: VehicleKnowledgeModel, offer: Partial<VehicleOffer>) {
  if (model.active === false || !validName(model.make) || !validName(model.model, 1)) return null;
  const rawModel = vehicleKnowledgeToken(offer.model);
  const compactModel = vehicleKnowledgeCompact(offer.model);
  // Model identity must come from model/generation evidence only. Make tokens can
  // falsely match Benz inside Mercedes-Benz, while trim tokens such as 316 CDI
  // are variant evidence and can falsely replace an exact Sprinter/Vito model.
  const combined = vehicleKnowledgeToken([offer.model, offer.generation].filter(Boolean).join(" "));
  if (!makeMatches(model, offer.make, combined)) return null;

  let best = 0;
  let matchedBy: VehicleModelMatch["matchedBy"] = "text";
  for (const [index, candidate] of modelSearchValues(model).entries()) {
    const candidateToken = vehicleKnowledgeToken(candidate);
    const candidateCompact = vehicleKnowledgeCompact(candidate);
    if (!candidateCompact) continue;
    if (candidateCompact.length === 1 && compactModel !== candidateCompact) continue;
    if (compactModel === candidateCompact) {
      const score = index === 0 ? 140 : 135;
      if (score > best) { best = score; matchedBy = index === 0 ? "model" : "alias"; }
      continue;
    }
    if (rawModel && boundaryIncludes(rawModel, candidateToken)) {
      const score = index === 0 ? 125 : 120;
      if (score > best) { best = score; matchedBy = index === 0 ? "model" : "alias"; }
      continue;
    }
    if (candidateCompact.length >= 3 && compactModel.startsWith(candidateCompact)) {
      const score = index === 0 ? 115 : 110;
      if (score > best) { best = score; matchedBy = index === 0 ? "model" : "alias"; }
      continue;
    }
    if (candidateToken.length >= 3 && boundaryIncludes(combined, candidateToken)) {
      const score = index === 0 ? 100 : 95;
      if (score > best) { best = score; matchedBy = "text"; }
    }
  }
  if (!best) return null;
  const year = Number(offer.year || 0);
  if (model.yearFrom && year && year < model.yearFrom - 1) return null;
  if (model.yearTo && year && year > model.yearTo + 1) return null;
  if (model.yearFrom || model.yearTo) best += 3;
  const popularity = Number(model.popularityDecile || 10);
  best += Math.max(0, 11 - popularity) / 10;
  return { model, score: best, matchedBy } satisfies VehicleModelMatch;
}

function appendNewIds<T extends { id: string }>(legacy: T[], additions: T[]) {
  const existing = new Set(legacy.map((row) => row.id));
  return [...legacy, ...additions.filter((row) => row?.id && !existing.has(row.id))];
}

function normalizeKnowledgeModels(rows: VehicleKnowledgeModel[]) {
  return rows
    .filter((row) => row && row.id && validName(row.make) && validName(row.model, 1))
    .map((row) => ({
      ...row,
      make: text(row.make),
      model: text(row.model),
      aliases: splitAliases(row.aliases),
      makeAliases: splitAliases(row.makeAliases),
      bodyTypes: splitAliases(row.bodyTypes),
      countries: splitAliases(row.countries),
      regions: splitAliases(row.regions),
    }));
}

export async function readVehicleKnowledgeModels() {
  if (!modelCache) {
    modelCache = Promise.all([
      readBundledChunkedDataJson<VehicleKnowledgeModel>(MODELS_PATH, []),
      readBundledDataJson<VehicleKnowledgeModel[]>(V2_BRIDGE_MODELS_PATH, []),
    ]).then(([legacy, bridge]) => normalizeKnowledgeModels(appendNewIds(legacy, bridge)));
  }
  return modelCache;
}

export async function readVehicleKnowledgeVariants() {
  if (!variantCache) {
    variantCache = Promise.all([
      readBundledChunkedDataJson<VehicleKnowledgeVariant>(VARIANTS_PATH, []),
      readBundledChunkedDataJson<VehicleKnowledgeVariant[]>(V2_BRIDGE_VARIANTS_PATH, []),
    ]).then(([legacy, bridge]) => appendNewIds(legacy, bridge)
      .filter((row) => row && row.id && row.modelId && positive(row.powerHp, 2_500)));
  }
  return variantCache;
}

export function resetVehicleKnowledgeCache() {
  modelCache = null;
  variantCache = null;
}

export async function findVehicleModel(offer: Partial<VehicleOffer>) {
  const ranked = (await readVehicleKnowledgeModels())
    .map((model) => scoreModel(model, offer))
    .filter((entry): entry is VehicleModelMatch => Boolean(entry))
    .sort((left, right) => right.score - left.score || left.model.model.localeCompare(right.model.model, "ru"));
  const best = ranked[0];
  if (!best) return null;
  const equal = ranked.filter((entry) => Math.abs(entry.score - best.score) < 0.001);
  const distinct = new Set(equal.map((entry) => entry.model.id));
  return distinct.size === 1 ? best : null;
}

function variantScore(variant: VehicleKnowledgeVariant, offer: Partial<VehicleOffer>) {
  if (variant.active === false) return -1;
  const year = Number(offer.year || 0);
  if (variant.yearFrom && (!year || year < variant.yearFrom)) return -1;
  if (variant.yearTo && (!year || year > variant.yearTo)) return -1;
  let score = 20;
  if (variant.yearFrom || variant.yearTo) score += 10;

  const engine = positive(offer.engineCc, 10_000);
  if (variant.engineCc) {
    if (!engine) return -1;
    const tolerance = Math.max(20, Number(variant.engineCcTolerance || 80));
    const delta = Math.abs(engine - variant.engineCc);
    if (delta > tolerance) return -1;
    score += 35 - Math.min(20, Math.round(delta / 10));
  }

  if (variant.fuel && offer.fuel) {
    const left = vehicleKnowledgeToken(variant.fuel);
    const right = vehicleKnowledgeToken(offer.fuel);
    if (left !== right && !left.includes(right) && !right.includes(left)) return -1;
    score += 12;
  }

  if (variant.transmission && offer.transmission) {
    if (vehicleKnowledgeCompact(variant.transmission) !== vehicleKnowledgeCompact(offer.transmission)) return -1;
    score += 5;
  }
  if (variant.drive && offer.drive) {
    if (vehicleKnowledgeCompact(variant.drive) !== vehicleKnowledgeCompact(offer.drive)) return -1;
    score += 5;
  }
  if (variant.trimContains?.length) {
    const haystack = vehicleKnowledgeToken([offer.generation, offer.trim, offer.engineType].filter(Boolean).join(" "));
    if (!variant.trimContains.every((part) => haystack.includes(vehicleKnowledgeToken(part)))) return -1;
    score += variant.trimContains.length * 6;
  }
  return score;
}

export async function findVehicleVariant(model: VehicleKnowledgeModel, offer: Partial<VehicleOffer>) {
  const ranked = (await readVehicleKnowledgeVariants())
    .filter((variant) => variant.modelId === model.id)
    .map((variant) => ({ variant, score: variantScore(variant, offer) }))
    .filter((entry) => entry.score >= 0)
    .sort((left, right) => right.score - left.score || Date.parse(right.variant.verifiedAt) - Date.parse(left.variant.verifiedAt));
  const best = ranked[0];
  if (!best) return null;
  const equal = ranked.filter((entry) => entry.score === best.score);
  const powers = new Set(equal.map((entry) => Math.round(entry.variant.powerHp * 10) / 10));
  return powers.size === 1 ? best.variant : null;
}

export async function resolveVehicleModelQuery(query: unknown, make?: unknown, limit = 30) {
  const requested = vehicleKnowledgeCompact(query);
  if (!requested) return [];
  const makeRequested = vehicleKnowledgeCompact(make);
  const rows = await readVehicleKnowledgeModels();
  return rows
    .map((model) => {
      const makeValues = makeSearchValues(model).map(vehicleKnowledgeCompact);
      if (makeRequested && !makeValues.includes(makeRequested)) return null;
      const values = modelSearchValues(model).map((value) => ({ value, compact: vehicleKnowledgeCompact(value) })).filter((entry) => entry.compact);
      let score = 0;
      for (const entry of values) {
        if (entry.compact === requested) score = Math.max(score, 100);
        else if (entry.compact.startsWith(requested)) score = Math.max(score, 80 - Math.min(20, entry.compact.length - requested.length));
        else if (entry.compact.includes(requested)) score = Math.max(score, 60 - Math.min(20, entry.compact.indexOf(requested)));
      }
      if (!score) return null;
      score += Math.max(0, 11 - Number(model.popularityDecile || 10));
      return { ...model, searchScore: score };
    })
    .filter((row): row is VehicleKnowledgeModel & { searchScore: number } => Boolean(row))
    .sort((left, right) => right.searchScore - left.searchScore || left.make.localeCompare(right.make, "ru") || left.model.localeCompare(right.model, "ru"))
    .slice(0, Math.max(1, limit));
}

export async function vehicleKnowledgeFacets(make?: unknown) {
  const requested = vehicleKnowledgeCompact(make);
  const rows = (await readVehicleKnowledgeModels()).filter((model) => {
    if (!requested) return true;
    return makeSearchValues(model).some((value) => vehicleKnowledgeCompact(value) === requested);
  });
  const makes = [...new Set(rows.map((row) => row.make))].sort((a, b) => a.localeCompare(b, "ru"));
  const models = rows
    .map((row) => ({ make: row.make, model: row.model, aliases: row.aliases || [], popularityDecile: row.popularityDecile }))
    .sort((left, right) => Number(left.popularityDecile || 10) - Number(right.popularityDecile || 10) || `${left.make} ${left.model}`.localeCompare(`${right.make} ${right.model}`, "ru"));
  return { makes, models };
}

export async function enrichOfferWithVehicleKnowledge<T extends VehicleOffer>(input: T): Promise<T> {
  const match = await findVehicleModel(input);
  if (!match) return input;
  const model = match.model;
  const canonical = {
    ...input,
    make: model.make,
    model: model.model,
    bodyType: input.bodyType || model.bodyTypes?.[0],
  } as T;
  const variant = await findVehicleVariant(model, canonical);
  const representativePowerHp = positive(model.representativePowerHp, 2_500);
  const powerResolution = resolveKnowledgePower({
    suppliedPowerHp: positive(canonical.powerHp, 2_500),
    suppliedConfidence: canonical.powerDataConfidence,
    suppliedSource: canonical.powerDataSource,
    variantPowerHp: positive(variant?.powerHp, 2_500),
    variantId: variant?.id,
    representativePowerHp,
    modelId: model.id,
  });
  const powerHp = powerResolution.powerHp;
  const motorPowers = (variant?.power30MinKwByMotor || []).map(Number).filter((value) => positive(value, 2_000));
  const total30 = positive(variant?.power30MinKw, 2_000)
    || (motorPowers.length ? Math.round(motorPowers.reduce((sum, value) => sum + value, 0) * 100) / 100 : undefined);
  const selectedPowerKw = powerResolution.usedVariant
    ? positive(variant?.powerKw, 2_000) || (powerHp ? Math.round((powerHp / 1.35962) * 100) / 100 : undefined)
    : powerResolution.usedRepresentative
      ? (powerHp ? Math.round((powerHp / 1.35962) * 100) / 100 : undefined)
      : powerHp
        ? positive(canonical.powerKw, 2_000) || Math.round((powerHp / 1.35962) * 100) / 100
        : undefined;
  return {
    ...canonical,
    generation: canonical.generation || variant?.generation,
    engineCc: canonical.engineCc || variant?.engineCc,
    fuel: canonical.fuel || variant?.fuel,
    transmission: canonical.transmission || variant?.transmission,
    drive: canonical.drive || variant?.drive,
    bodyType: canonical.bodyType || variant?.bodyType,
    powertrainKind: canonical.powertrainKind && canonical.powertrainKind !== "unknown" ? canonical.powertrainKind : variant?.powertrainKind || canonical.powertrainKind,
    powerHp,
    powerKw: selectedPowerKw,
    icePowerKw: canonical.icePowerKw || positive(variant?.icePowerKw, 2_000),
    power30MinKwByMotor: canonical.power30MinKwByMotor?.length ? canonical.power30MinKwByMotor : motorPowers.length ? motorPowers : undefined,
    power30MinKw: canonical.power30MinKw || total30,
    utilizationPowerKw: canonical.utilizationPowerKw || positive(variant?.utilizationPowerKw, 4_000),
    powerDataConfidence: powerResolution.confidence,
    powerDataSource: powerResolution.source,
    operational: {
      ...canonical.operational,
      raw: {
        ...(typeof canonical.operational?.raw === "object" && canonical.operational.raw ? canonical.operational.raw as object : {}),
        vehicleKnowledgeModel: {
          id: model.id,
          matchedBy: match.matchedBy,
          score: match.score,
          popularityDecile: model.popularityDecile,
          representativePowerHp: model.representativePowerHp,
          yearFrom: model.yearFrom,
          yearTo: model.yearTo,
        },
        ...(variant ? { vehicleKnowledgeVariant: { id: variant.id, sourceType: variant.sourceType } } : {}),
        ...(powerResolution.conflict ? { powerConflictResolution: powerResolution.conflict } : {}),
      },
    },
  } as T;
}
