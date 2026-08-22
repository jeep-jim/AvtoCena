import fs from "node:fs/promises";
import path from "node:path";
import { getDataRoot } from "../data";
import type { VehicleOffer } from "./types";
import { readEncyclopediaIdentityDataset } from "./encyclopedia-identity-data";
import { enrichOfferWithVehicleKnowledge } from "./vehicle-knowledge";

export type KnowledgeCoreVariant = {
  id: string;
  modelId: string;
  generationId?: string | null;
  faceliftId?: string | null;
  name?: string;
  market?: string;
  yearFrom?: number;
  yearTo?: number | null;
  bodyType?: string | null;
  powertrainKind?: string | null;
  fuel?: string | null;
  engineCode?: string | null;
  engineCc?: number | null;
  transmission?: string | null;
  gears?: number | null;
  drive?: string | null;
  powerHp?: number | null;
  powerKw?: number | null;
  icePowerKw?: number | null;
  motorPeakKw?: number | null;
  power30MinKw?: number | null;
  power30MinKwByMotor?: number[] | null;
  batteryKwh?: number | null;
  status?: string;
  evidence?: Array<{ sourceId?: string; fields?: string[]; status?: string; confidence?: string }>;
  provenance?: Record<string, unknown>;
  coreSource?: "vehicle-encyclopedia-v2" | "knowledge-source-corpus";
};

export type KnowledgeCoreCompiledModel = {
  id: string;
  canonicalBrandId?: string;
  canonicalMake?: string;
  canonicalModel?: string;
  sourceIdentities?: Array<Record<string, unknown>>;
  imageCandidates?: Array<{ url: string; binaryVerified: false; sourceKeys?: string[] }>;
  imageBinaryVerified?: boolean;
  sourceConflictCount?: number;
};

export type CoreIndex = {
  variantsByModel: Map<string, KnowledgeCoreVariant[]>;
  modelByCanonical: Map<string, string>;
  compiledModelsByCanonical: Map<string, KnowledgeCoreCompiledModel>;
  modelCount: number;
  variantCount: number;
  compiledModelCount: number;
  compiledVariantCount: number;
};

const CORE_ROOT = path.join("catalog", "vehicle-encyclopedia-v2", "chunks");
const COMPILED_CORE_ROOT = path.join("catalog", "knowledge-core");
let coreIndexPromise: Promise<CoreIndex | null> | null = null;

function clean(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim();
}
function compact(value: unknown) {
  return clean(value).toLocaleLowerCase("en-US").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^\p{L}\p{N}]+/gu, "");
}
function canonicalKey(make: unknown, model: unknown) { return `${compact(make)}:${compact(model)}`; }
function positive(value: unknown) { const n = Number(value); return Number.isFinite(n) && n > 0 ? n : 0; }
function yearMatches(variant: KnowledgeCoreVariant, year: number) {
  if (!year) return true;
  const from = Number(variant.yearFrom || 0);
  const to = Number(variant.yearTo || new Date().getFullYear() + 1);
  return (!from || year >= from) && (!to || year <= to);
}
function normalizedPowertrain(value: unknown) {
  const text = clean(value).toLowerCase();
  if (/bev|electric|электро/.test(text)) return "bev";
  if (/phev|plug.?in/.test(text)) return "phev";
  if (/erev|range.?extender|series.?hybrid/.test(text)) return "erev";
  if (/hev|hybrid|гибрид/.test(text)) return "hev";
  if (/mhev|mild/.test(text)) return "mhev";
  if (/fcev|hydrogen/.test(text)) return "fcev";
  if (/ice|petrol|gasoline|diesel|бенз|диз/.test(text)) return "ice";
  return text;
}
function normalizedFuel(value: unknown) {
  const text = clean(value).toLowerCase();
  if (/electric|электро/.test(text)) return "electric";
  if (/diesel|диз/.test(text)) return "diesel";
  if (/petrol|gasoline|бенз/.test(text)) return "petrol";
  if (/hybrid|гибрид|phev|hev|erev/.test(text)) return "hybrid";
  if (/hydrogen|водород/.test(text)) return "hydrogen";
  return compact(text);
}
function normalizedDrive(value: unknown) {
  const text = clean(value).toLowerCase();
  if (/awd|4wd|4x4|полный/.test(text)) return "awd";
  if (/fwd|front|передн/.test(text)) return "fwd";
  if (/rwd|rear|задн/.test(text)) return "rwd";
  return compact(text);
}
function normalizedTransmission(value: unknown) {
  const text = clean(value).toLowerCase();
  if (/dct|dual.?clutch|робот/.test(text)) return "dct";
  if (/cvt|вариатор/.test(text)) return "cvt";
  if (/automatic|автомат|\bat\b/.test(text)) return "automatic";
  if (/manual|механ|\bmt\b/.test(text)) return "manual";
  return compact(text);
}
function specificBody(value: unknown) {
  const text = clean(value);
  if (!text || /^(passenger car|car|автомобиль|unknown)$/i.test(text)) return "";
  return text;
}
function normalizedBody(value: unknown) {
  const text = specificBody(value).toLowerCase();
  if (/suv|crossover|кроссов/.test(text)) return "suv";
  if (/sedan|saloon|седан/.test(text)) return "sedan";
  if (/hatch|хэтч/.test(text)) return "hatchback";
  if (/wagon|estate|универсал/.test(text)) return "wagon";
  if (/coupe|купе/.test(text)) return "coupe";
  if (/convertible|cabrio|кабри/.test(text)) return "convertible";
  if (/minivan|mpv|минивэн/.test(text)) return "mpv";
  if (/pickup|пикап/.test(text)) return "pickup";
  return compact(text);
}
function marketTokens(market: unknown) {
  switch (clean(market).toLowerCase()) {
    case "japan": return ["japan", "jp"];
    case "china": return ["china", "cn"];
    case "korea": return ["korea", "kr", "southkorea"];
    case "uae": return ["uae", "gcc", "middleeast"];
    case "europe": return ["europe", "eea", "eu"];
    default: return [];
  }
}
function fieldTrusted(variant: KnowledgeCoreVariant, field: string) {
  if (variant.status === "verified") return true;
  return (variant.evidence || []).some((item) => item?.status === "verified"
    && ["official", "high"].includes(String(item?.confidence || ""))
    && Array.isArray(item?.fields)
    && item.fields.includes(field));
}
function sourcePowerAuthoritative(offer: VehicleOffer) {
  const source = clean((offer as any).powerDataSource).toLowerCase();
  const confidence = clean((offer as any).powerDataConfidence).toLowerCase();
  // source_exact means only that the marketplace field was extracted exactly.
  // It does NOT prove the seller/source value is physically or factually true.
  // Only official/regulatory provenance is strong enough to block a conflicting
  // uniquely matched Encyclopedia V2 variant.
  return /homolog|type.?approval|coc|certificate|registration|government|manufacturer.?official|official.?spec|regulatory/.test(`${source} ${confidence}`);
}

async function loadCoreIndex(): Promise<CoreIndex | null> {
  const identity = await readEncyclopediaIdentityDataset();
  if (!identity) return null;
  const modelByCanonical = new Map<string, string>();
  const brandNames = new Map(identity.brands.map((brand) => [brand.id, brand.canonicalName]));
  for (const model of identity.models) {
    const make = brandNames.get(model.brandId);
    if (make) modelByCanonical.set(canonicalKey(make, model.canonicalName), model.id);
  }
  const root = path.resolve(getDataRoot(), CORE_ROOT);
  let names: string[] = [];
  try { names = (await fs.readdir(root)).filter((name) => /^variants-\d+\.json$/.test(name)).sort(); }
  catch { names = []; }
  const variantsByModel = new Map<string, KnowledgeCoreVariant[]>();
  const compiledModelsByCanonical = new Map<string, KnowledgeCoreCompiledModel>();
  let variantCount = 0;
  let compiledVariantCount = 0;
  const addVariant = (raw: KnowledgeCoreVariant, coreSource: KnowledgeCoreVariant["coreSource"]) => {
    if (!raw?.id || !raw?.modelId || raw.status === "retired" || raw.status === "unresolved" || raw.status === "seed") return;
    const variant = { ...raw, coreSource };
    const list = variantsByModel.get(variant.modelId) || [];
    list.push(variant);
    variantsByModel.set(variant.modelId, list);
    variantCount++;
    if (coreSource === "knowledge-source-corpus") compiledVariantCount++;
  };
  for (const name of names) {
    const payload = JSON.parse(await fs.readFile(path.join(root, name), "utf8"));
    if (payload?.schemaVersion !== 2 || payload?.entityType !== "variant" || !Array.isArray(payload.records)) continue;
    for (const variant of payload.records as KnowledgeCoreVariant[]) addVariant(variant, "vehicle-encyclopedia-v2");
  }
  const compiledRoot = path.resolve(getDataRoot(), COMPILED_CORE_ROOT);
  try {
    const manifest = JSON.parse(await fs.readFile(path.join(compiledRoot, "manifest.json"), "utf8"));
    if (manifest?.schemaVersion !== 1 || manifest?.status !== "ready" || manifest?.runtimeContract?.power30Min === undefined) {
      throw new Error("knowledge_core_compiled_manifest_invalid");
    }
    const compiledChunks = path.join(compiledRoot, "chunks");
    const compiledNames = (await fs.readdir(compiledChunks)).sort();
    for (const name of compiledNames.filter((value) => /^models-\d+\.json$/.test(value))) {
      const payload = JSON.parse(await fs.readFile(path.join(compiledChunks, name), "utf8"));
      if (payload?.schemaVersion !== 1 || payload?.entityType !== "compiled_model" || !Array.isArray(payload.records)) {
        throw new Error(`knowledge_core_compiled_model_chunk_invalid:${name}`);
      }
      for (const model of payload.records as KnowledgeCoreCompiledModel[]) {
        if (!model?.id || compiledModelsByCanonical.has(model.id)) throw new Error(`knowledge_core_compiled_model_duplicate:${model?.id || name}`);
        compiledModelsByCanonical.set(model.id, model);
      }
    }
    for (const name of compiledNames.filter((value) => /^variants-\d+\.json$/.test(value))) {
      const payload = JSON.parse(await fs.readFile(path.join(compiledChunks, name), "utf8"));
      if (payload?.schemaVersion !== 1 || payload?.entityType !== "compiled_variant" || !Array.isArray(payload.records)) {
        throw new Error(`knowledge_core_compiled_variant_chunk_invalid:${name}`);
      }
      for (const variant of payload.records as KnowledgeCoreVariant[]) addVariant(variant, "knowledge-source-corpus");
    }
    if (compiledModelsByCanonical.size !== Number(manifest?.counts?.compiledCanonicalModels)
      || compiledVariantCount !== Number(manifest?.counts?.compiledSourceVariants)) {
      throw new Error("knowledge_core_compiled_count_mismatch");
    }
  } catch (error: any) {
    if (error?.code !== "ENOENT") throw error;
  }
  return {
    variantsByModel,
    modelByCanonical,
    compiledModelsByCanonical,
    modelCount: identity.models.length,
    variantCount,
    compiledModelCount: compiledModelsByCanonical.size,
    compiledVariantCount,
  };
}

export async function readKnowledgeCoreIndex() {
  if (!coreIndexPromise) coreIndexPromise = loadCoreIndex();
  return coreIndexPromise;
}

function variantScore(variant: KnowledgeCoreVariant, offer: VehicleOffer) {
  const year = Number(offer.year || 0);
  if (!yearMatches(variant, year)) return -1000;
  let score = 2;
  let discriminators = 0;
  const tokens = marketTokens(offer.market);
  const market = compact(variant.market);
  if (tokens.length && tokens.some((token) => market.includes(compact(token)))) score += 2;

  const engine = positive(offer.engineCc);
  const candidateEngine = positive(variant.engineCc);
  if (engine && candidateEngine) {
    discriminators++;
    const tolerance = Math.max(30, engine * 0.025);
    score += Math.abs(engine - candidateEngine) <= tolerance ? 6 : -9;
  }
  const power = positive(offer.powerHp) || (positive(offer.powerKw) ? positive(offer.powerKw) * 1.35962 : 0);
  const candidatePower = positive(variant.powerHp) || (positive(variant.powerKw) ? positive(variant.powerKw) * 1.35962 : 0);
  if (power && candidatePower) {
    discriminators++;
    const tolerance = Math.max(8, power * 0.05);
    score += Math.abs(power - candidatePower) <= tolerance ? 5 : -7;
  }
  const fuel = normalizedFuel(offer.fuel);
  const candidateFuel = normalizedFuel(variant.fuel);
  if (fuel && candidateFuel) { discriminators++; score += fuel === candidateFuel ? 4 : -5; }
  const powertrain = normalizedPowertrain(offer.powertrainKind || offer.fuel);
  const candidatePowertrain = normalizedPowertrain(variant.powertrainKind || variant.fuel);
  if (powertrain && candidatePowertrain) { discriminators++; score += powertrain === candidatePowertrain ? 4 : -5; }
  const transmission = normalizedTransmission(offer.transmission);
  const candidateTransmission = normalizedTransmission(variant.transmission);
  if (transmission && candidateTransmission) { discriminators++; score += transmission === candidateTransmission ? 3 : -3; }
  const drive = normalizedDrive(offer.drive);
  const candidateDrive = normalizedDrive(variant.drive);
  if (drive && candidateDrive) { discriminators++; score += drive === candidateDrive ? 3 : -3; }
  const body = normalizedBody(offer.bodyType);
  const candidateBody = normalizedBody(variant.bodyType);
  if (body && candidateBody) { discriminators++; score += body === candidateBody ? 2 : -2; }
  if (variant.status === "verified") score += 3;
  // Curated V2 stays ahead of source-observation candidates when both describe
  // the same offer; the corpus candidate is used only when it wins uniquely.
  if (variant.coreSource === "vehicle-encyclopedia-v2") score += 4;
  return discriminators ? score : variant.status === "verified" ? score : -1000;
}

function matchCoreVariant(variants: KnowledgeCoreVariant[], offer: VehicleOffer) {
  const ranked = variants
    .map((variant) => ({ variant, score: variantScore(variant, offer) }))
    .filter((item) => item.score >= 5)
    .sort((left, right) => right.score - left.score || left.variant.id.localeCompare(right.variant.id));
  if (!ranked.length) return null;
  if (ranked.length > 1 && ranked[0].score - ranked[1].score < 3) return null;
  return ranked[0];
}

function applyTrustedVariant(offer: VehicleOffer, variant: KnowledgeCoreVariant, score: number) {
  const next: any = { ...offer };
  const applied: string[] = [];
  const fill = (field: string, value: unknown) => {
    if ((next[field] === undefined || next[field] === null || next[field] === "" || Number(next[field]) === 0) && value !== undefined && value !== null && value !== "" && fieldTrusted(variant, field)) {
      next[field] = value;
      applied.push(field);
    }
  };
  fill("engineCc", variant.engineCc);
  fill("fuel", variant.fuel);
  fill("powertrainKind", variant.powertrainKind);
  fill("transmission", variant.transmission);
  fill("drive", variant.drive);
  const candidateBody = specificBody(variant.bodyType);
  if (candidateBody && fieldTrusted(variant, "bodyType") && (!specificBody(next.bodyType) || /^(passenger car|car)$/i.test(clean(next.bodyType)))) {
    next.bodyType = candidateBody;
    applied.push("bodyType");
  }
  if (!sourcePowerAuthoritative(offer)) {
    const candidateHp = positive(variant.powerHp) || (positive(variant.powerKw) ? Number((positive(variant.powerKw) * 1.35962).toFixed(1)) : 0);
    if (candidateHp && (fieldTrusted(variant, "powerHp") || fieldTrusted(variant, "powerKw"))) {
      const currentHp = positive(next.powerHp);
      if (!currentHp || Math.abs(currentHp - candidateHp) > Math.max(8, candidateHp * 0.08)) {
        next.powerHp = candidateHp;
        if (positive(variant.powerKw)) next.powerKw = positive(variant.powerKw);
        next.powerDataSource = `encyclopedia_v2:${variant.id}`;
        next.powerDataConfidence = variant.status === "verified" ? "verified" : "source_exact";
        applied.push("powerHp");
      }
    }
  }
  fill("icePowerKw", variant.icePowerKw);
  if (fieldTrusted(variant, "power30MinKw")) fill("power30MinKw", variant.power30MinKw);
  if (fieldTrusted(variant, "power30MinKwByMotor") && Array.isArray(variant.power30MinKwByMotor) && !Array.isArray(next.power30MinKwByMotor)) {
    next.power30MinKwByMotor = variant.power30MinKwByMotor;
    applied.push("power30MinKwByMotor");
  }
  next.generation = next.generation || variant.generationId || undefined;
  next.operational = {
    ...(next.operational || {}),
    knowledgeCore: {
      version: 1,
      source: variant.coreSource || "vehicle-encyclopedia-v2",
      modelId: variant.modelId,
      generationId: variant.generationId || null,
      variantId: variant.id,
      variantStatus: variant.status || null,
      score,
      fieldsApplied: applied,
      provenance: variant.provenance || null,
    },
  };
  return next as VehicleOffer;
}

export async function enrichOfferWithKnowledgeCore<T extends VehicleOffer>(offer: T): Promise<T> {
  const index = await readKnowledgeCoreIndex();
  let current: VehicleOffer = offer;
  let matched = false;
  if (index) {
    const modelId = index.modelByCanonical.get(canonicalKey(offer.make, offer.model));
    const compiledModel = modelId ? index.compiledModelsByCanonical.get(modelId) : undefined;
    const compiledMeta = compiledModel ? {
      sourceCorpusConnected: true,
      sourceIdentityCount: compiledModel.sourceIdentities?.length || 0,
      sourceConflictCount: compiledModel.sourceConflictCount || 0,
      modelImageCandidates: compiledModel.imageCandidates || [],
      modelImageBinaryVerified: compiledModel.imageBinaryVerified === true,
    } : {
      sourceCorpusConnected: false,
      sourceIdentityCount: 0,
      sourceConflictCount: 0,
      modelImageCandidates: [],
      modelImageBinaryVerified: false,
    };
    const variants = modelId ? index.variantsByModel.get(modelId) || [] : [];
    const match = variants.length ? matchCoreVariant(variants, offer) : null;
    if (match) {
      current = applyTrustedVariant(offer, match.variant, match.score);
      current = {
        ...current,
        operational: {
          ...(current.operational || {}),
          knowledgeCore: {
            ...((current.operational as any)?.knowledgeCore || {}),
            ...compiledMeta,
          },
        },
      } as VehicleOffer;
      matched = true;
    } else {
      current = {
        ...offer,
        operational: {
          ...(offer.operational || {}),
          knowledgeCore: {
            version: 1,
            source: "vehicle-encyclopedia-v2",
            modelId: modelId || null,
            generationId: null,
            variantId: null,
            score: null,
            fieldsApplied: [],
            ...compiledMeta,
          },
        },
      } as VehicleOffer;
    }
  }
  // Legacy knowledge is now a compatibility fallback behind one CORE API. It can
  // fill gaps that the V2 corpus has not migrated yet, but callers no longer
  // need to know which physical dataset supplied the fact.
  const enriched = await enrichOfferWithVehicleKnowledge(current);
  if (matched || index) {
    return {
      ...enriched,
      operational: {
        ...(enriched.operational || {}),
        knowledgeCore: {
          ...((current.operational as any)?.knowledgeCore || {}),
          legacyFallbackApplied: true,
        },
      },
    } as unknown as T;
  }
  return enriched as T;
}

export function resetKnowledgeCoreForTests() { coreIndexPromise = null; }
