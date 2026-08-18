import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { canonicalCatalogBrand } from "./brands";
import { readBundledChunkedDataJson, readBundledDataJson } from "../bundled-data";
import {
  readVehicleKnowledgeModels,
  readVehicleKnowledgeVariants,
  type VehicleKnowledgeModel,
  type VehicleKnowledgeVariant,
} from "./vehicle-knowledge";

const VERIFIED_V2_VARIANTS_PATH = "catalog/vehicle-knowledge/v2-bridge-verified-variants.json";
const VERIFIED_CORPUS_ROOT = "catalog/vehicle-knowledge/encyclopedia-verified";
const VERIFIED_CORPUS_INDEX_PATH = `${VERIFIED_CORPUS_ROOT}/verified-corpus-index.json`;

type VerifiedCorpusIndex = {
  version: 1;
  encoding: "gzip-base64";
  sourceCheckpoint: string;
  uncompressedBytes: number;
  sha256: string;
  totals: { models: number; variants: number };
  parts: string[];
};

type VerifiedCorpusPart = {
  version: 1;
  part: number;
  parts: number;
  data: string;
};

export type VerifiedCorpusGeneration = {
  id: string;
  name: string;
  status: "verified" | "review" | "seed" | string;
  productionFrom?: string | null;
  productionTo?: string | null;
};

export type VerifiedCorpusModel = {
  id: string;
  brandId: string;
  canonicalName: string;
  slug?: string;
  aliases?: string[];
  productionFrom?: string | null;
  productionTo?: string | null;
  bodyTypes?: string[];
  status: "verified" | string;
};

export type VerifiedCorpusVariant = {
  id: string;
  modelId: string;
  name?: string;
  market?: string;
  yearFrom?: number;
  yearTo?: number;
  bodyType?: string;
  powertrainKind?: string;
  fuel?: string;
  engineCc?: number;
  transmission?: string;
  drive?: string;
  powerHp?: number;
  powerKw?: number;
  icePowerKw?: number;
  motorPeakKw?: number;
  systemPowerKw?: number;
  power30MinKw?: number;
  power30MinKwByMotor?: number[];
  utilizationPowerKw?: number;
  generation?: VerifiedCorpusGeneration | null;
  facelift?: VerifiedCorpusGeneration | null;
  sourceIds?: string[];
  updatedAt?: string;
  status: "verified" | string;
};

export type VerifiedEncyclopediaCorpus = {
  version: number;
  sourceCheckpoint: string;
  totals: { models: number; variants: number };
  models: VerifiedCorpusModel[];
  variants: VerifiedCorpusVariant[];
};

export type EncyclopediaKnowledgeVariant = Omit<VehicleKnowledgeVariant, "powerHp" | "powertrainKind" | "sourceType"> & {
  name?: string;
  market?: string;
  powerHp?: number;
  powertrainKind?: string;
  motorPeakKw?: number;
  systemPowerKw?: number;
  sourceType: VehicleKnowledgeVariant["sourceType"] | "encyclopedia_v2";
  generationMeta?: VerifiedCorpusGeneration | null;
  faceliftMeta?: VerifiedCorpusGeneration | null;
  encyclopediaStatus?: string;
};

let verifiedCorpusCache: Promise<VerifiedEncyclopediaCorpus> | null = null;
let encyclopediaVariantCache: Promise<EncyclopediaKnowledgeVariant[]> | null = null;
let encyclopediaModelCache: Promise<VehicleKnowledgeModel[]> | null = null;

function appendNewIds<T extends { id: string }>(base: T[], additions: T[]) {
  const ids = new Set(base.map((row) => row.id));
  return [...base, ...additions.filter((row) => row?.id && !ids.has(row.id))];
}

function year(value: unknown) {
  const match = String(value || "").match(/^(\d{4})/);
  const parsed = match ? Number(match[1]) : 0;
  return parsed >= 1900 && parsed <= 2100 ? parsed : undefined;
}

function corpusVariantToKnowledge(
  row: VerifiedCorpusVariant,
  model: VerifiedCorpusModel,
): EncyclopediaKnowledgeVariant {
  return {
    id: row.id,
    modelId: row.modelId,
    make: canonicalCatalogBrand(model.brandId),
    model: model.canonicalName,
    name: row.name,
    market: row.market,
    generation: row.generation?.name,
    yearFrom: row.yearFrom,
    yearTo: row.yearTo,
    productionFrom: row.facelift?.productionFrom || row.generation?.productionFrom || undefined,
    productionTo: row.facelift?.productionTo || row.generation?.productionTo || undefined,
    engineCc: row.engineCc,
    fuel: row.fuel,
    transmission: row.transmission,
    drive: row.drive,
    bodyType: row.bodyType,
    powertrainKind: row.powertrainKind,
    powerHp: row.powerHp,
    powerKw: row.powerKw,
    icePowerKw: row.icePowerKw,
    motorPeakKw: row.motorPeakKw,
    systemPowerKw: row.systemPowerKw,
    power30MinKw: row.power30MinKw,
    power30MinKwByMotor: row.power30MinKwByMotor,
    utilizationPowerKw: row.utilizationPowerKw,
    sourceType: "encyclopedia_v2",
    sourceIds: row.sourceIds || [],
    verifiedAt: row.updatedAt || "",
    active: true,
    generationMeta: row.generation || null,
    faceliftMeta: row.facelift || null,
    encyclopediaStatus: row.status,
  };
}

export async function readVerifiedEncyclopediaCorpus() {
  if (!verifiedCorpusCache) {
    verifiedCorpusCache = (async () => {
      const index = await readBundledDataJson<VerifiedCorpusIndex | null>(VERIFIED_CORPUS_INDEX_PATH, null);
      if (!index || index.version !== 1 || index.encoding !== "gzip-base64" || !Array.isArray(index.parts) || !index.parts.length) {
        throw new Error("verified_encyclopedia_corpus_index_invalid");
      }
      const parts = await Promise.all(index.parts.map((file) => readBundledDataJson<VerifiedCorpusPart | null>(`${VERIFIED_CORPUS_ROOT}/${file}`, null)));
      if (parts.some((part) => !part || part.version !== 1 || !part.data)) {
        throw new Error("verified_encyclopedia_corpus_part_invalid");
      }
      const encoded = (parts as VerifiedCorpusPart[])
        .sort((left, right) => left.part - right.part)
        .map((part) => part.data)
        .join("");
      const decoded = gunzipSync(Buffer.from(encoded, "base64"));
      if (decoded.byteLength !== Number(index.uncompressedBytes)) {
        throw new Error(`verified_encyclopedia_corpus_size_mismatch:${decoded.byteLength}`);
      }
      const digest = createHash("sha256").update(decoded).digest("hex");
      if (digest !== index.sha256) {
        throw new Error(`verified_encyclopedia_corpus_sha_mismatch:${digest}`);
      }
      const parsed = JSON.parse(decoded.toString("utf8")) as VerifiedEncyclopediaCorpus;
      if (!parsed || !Array.isArray(parsed.models) || !Array.isArray(parsed.variants)
        || parsed.models.length !== index.totals.models || parsed.variants.length !== index.totals.variants) {
        throw new Error("verified_encyclopedia_corpus_totals_mismatch");
      }
      return parsed;
    })();
  }
  return verifiedCorpusCache;
}

export async function readEncyclopediaKnowledgeVariants() {
  if (!encyclopediaVariantCache) {
    encyclopediaVariantCache = Promise.all([
      readVehicleKnowledgeVariants(),
      readBundledChunkedDataJson<VehicleKnowledgeVariant>(VERIFIED_V2_VARIANTS_PATH, []),
      readVerifiedEncyclopediaCorpus(),
    ]).then(([runtime, previewV2, corpus]) => {
      const preview = previewV2.filter((row) => row?.id && row?.modelId && Number(row.powerHp) > 0) as EncyclopediaKnowledgeVariant[];
      const models = new Map(corpus.models.map((model) => [model.id, model]));
      const verified = corpus.variants
        .filter((row) => row?.id && row?.modelId && row.status === "verified" && models.has(row.modelId))
        .map((row) => corpusVariantToKnowledge(row, models.get(row.modelId)!));
      return appendNewIds(appendNewIds(runtime as EncyclopediaKnowledgeVariant[], preview), verified);
    });
  }
  return encyclopediaVariantCache;
}

export async function readEncyclopediaKnowledgeModels() {
  if (!encyclopediaModelCache) {
    encyclopediaModelCache = Promise.all([
      readVehicleKnowledgeModels(),
      readVerifiedEncyclopediaCorpus(),
    ]).then(([runtime, corpus]) => {
      const variantsByModel = new Map<string, VerifiedCorpusVariant[]>();
      for (const variant of corpus.variants) {
        if (variant.status !== "verified") continue;
        const rows = variantsByModel.get(variant.modelId) || [];
        rows.push(variant);
        variantsByModel.set(variant.modelId, rows);
      }
      const verifiedModels: VehicleKnowledgeModel[] = corpus.models
        .filter((model) => variantsByModel.has(model.id))
        .flatMap((model) => {
          const variantDates = (variantsByModel.get(model.id) || [])
            .map((row) => String(row.updatedAt || ""))
            .filter(Boolean)
            .sort();
          const updatedAt = variantDates.at(-1);
          if (!updatedAt) return [];
          return [{
            id: model.id,
            make: canonicalCatalogBrand(model.brandId),
            model: model.canonicalName,
            aliases: model.aliases || [],
            bodyTypes: model.bodyTypes || [],
            yearFrom: year(model.productionFrom),
            yearTo: year(model.productionTo),
            source: "manual" as const,
            sourceVersion: `Encyclopedia V2 verified corpus ${corpus.sourceCheckpoint}`,
            updatedAt,
            active: true,
          }];
        });
      return appendNewIds(runtime, verifiedModels);
    });
  }
  return encyclopediaModelCache;
}

export async function readEncyclopediaStats() {
  const [models, variants, corpus] = await Promise.all([
    readEncyclopediaKnowledgeModels(),
    readEncyclopediaKnowledgeVariants(),
    readVerifiedEncyclopediaCorpus(),
  ]);
  return {
    models: models.length,
    specifications: variants.length,
    verifiedV2Models: corpus.totals.models,
    verifiedV2Specifications: corpus.totals.variants,
    sourceCheckpoint: corpus.sourceCheckpoint,
  };
}
