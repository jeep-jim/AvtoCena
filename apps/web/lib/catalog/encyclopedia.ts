import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { canonicalCatalogBrand } from "./brands";
import { getDataRoot } from "../data";
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
const STAGING_CORPUS_ROOT = "catalog/vehicle-encyclopedia-v2";

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
  evidenceVerified?: boolean;
  evidenceOfficial?: boolean;
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
  evidenceVerified?: boolean;
  evidenceOfficial?: boolean;
};

export type VerifiedEncyclopediaCorpus = {
  version: number;
  sourceCheckpoint: string;
  totals: { models: number; variants: number };
  models: VerifiedCorpusModel[];
  variants: VerifiedCorpusVariant[];
};

type StagingAlias = { value?: string; safe?: boolean };
type StagingEvidence = { sourceId?: string; status?: string; confidence?: string };
type StagingManifest = {
  schemaVersion?: number;
  workspace?: string;
  lastCheckpoint?: string;
  collections?: Record<string, { records?: number }>;
};
type StagingChunk<T> = { schemaVersion?: number; entityType?: string; records?: T[] };
type StagingBrand = { id: string; canonicalName: string };
type StagingModel = {
  id: string;
  brandId: string;
  canonicalName: string;
  slug?: string;
  aliases?: StagingAlias[];
  sourceNames?: StagingAlias[];
  productionFrom?: string | null;
  productionTo?: string | null;
  bodyTypes?: string[];
  status?: string;
  evidence?: StagingEvidence[];
  updatedAt?: string;
};
type StagingGeneration = {
  id: string;
  name?: string;
  status?: string;
  productionFrom?: string | null;
  productionTo?: string | null;
  evidence?: StagingEvidence[];
};
type StagingVariant = {
  id: string;
  modelId: string;
  generationId?: string | null;
  faceliftId?: string | null;
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
  status?: string;
  evidence?: StagingEvidence[];
  updatedAt?: string;
};
type StagingEncyclopediaCorpus = {
  manifest: StagingManifest;
  brands: StagingBrand[];
  models: StagingModel[];
  variants: Array<StagingVariant & { generation?: VerifiedCorpusGeneration | null; facelift?: VerifiedCorpusGeneration | null }>;
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
  encyclopediaEvidenceVerified?: boolean;
  encyclopediaEvidenceOfficial?: boolean;
};

export type EncyclopediaKnowledgeModel = VehicleKnowledgeModel & {
  encyclopediaStatus?: string;
  encyclopediaEvidenceVerified?: boolean;
  encyclopediaEvidenceOfficial?: boolean;
};

let verifiedCorpusCache: Promise<VerifiedEncyclopediaCorpus> | null = null;
let stagingCorpusCache: Promise<StagingEncyclopediaCorpus> | null = null;
let encyclopediaVariantCache: Promise<EncyclopediaKnowledgeVariant[]> | null = null;
let encyclopediaModelCache: Promise<EncyclopediaKnowledgeModel[]> | null = null;

function mergeById<T extends { id: string }>(...collections: T[][]) {
  const rows = new Map<string, T>();
  for (const collection of collections) for (const row of collection) if (row?.id) rows.set(row.id, row);
  return [...rows.values()];
}

function year(value: unknown) {
  const match = String(value || "").match(/^(\d{4})/);
  const parsed = match ? Number(match[1]) : 0;
  return parsed >= 1900 && parsed <= 2100 ? parsed : undefined;
}

function brandKey(value: unknown) {
  return canonicalCatalogBrand(String(value || "")).trim().toLocaleLowerCase("en-US");
}

function evidenceSummary(evidence: StagingEvidence[] | undefined) {
  const rows = evidence || [];
  return {
    verified: rows.some((row) => row?.status === "verified"),
    official: rows.some((row) => row?.status === "verified" && row?.confidence === "official"),
    sourceIds: [...new Set(rows.map((row) => String(row?.sourceId || "").trim()).filter(Boolean))],
  };
}

function aliasValues(...collections: Array<StagingAlias[] | undefined>) {
  return [...new Set(collections.flatMap((rows) => rows || [])
    .filter((row) => row?.safe === true && String(row?.value || "").trim())
    .map((row) => String(row.value).trim()))];
}

function stagingRoot() {
  const dataRoot = path.resolve(getDataRoot());
  const target = path.resolve(dataRoot, STAGING_CORPUS_ROOT);
  if (!target.startsWith(`${dataRoot}${path.sep}`)) throw new Error("encyclopedia_staging_invalid_root");
  return target;
}

async function readLocalJson<T>(file: string): Promise<T> {
  return JSON.parse(await fs.readFile(file, "utf8")) as T;
}

async function readStagingChunks<T>(root: string, entity: "brand" | "model" | "generation" | "facelift" | "variant", prefix: string) {
  const directory = path.join(root, "chunks");
  const names = (await fs.readdir(directory)).filter((name) => name.startsWith(prefix) && name.endsWith(".json")).sort();
  if (!names.length) throw new Error(`encyclopedia_staging_${entity}_chunks_missing`);
  const chunks = await Promise.all(names.map(async (name) => {
    const chunk = await readLocalJson<StagingChunk<T>>(path.join(directory, name));
    if (chunk.schemaVersion !== 2 || chunk.entityType !== entity || !Array.isArray(chunk.records)) {
      throw new Error(`encyclopedia_staging_invalid_${entity}_chunk:${name}`);
    }
    if (chunk.records.length > 250) throw new Error(`encyclopedia_staging_chunk_overflow:${name}`);
    return chunk.records;
  }));
  return chunks.flat();
}

function expectedStagingCount(manifest: StagingManifest, entity: string) {
  const value = Number(manifest.collections?.[entity]?.records);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function generationMeta(row: StagingGeneration | undefined): VerifiedCorpusGeneration | null {
  if (!row) return null;
  const evidence = evidenceSummary(row.evidence);
  return {
    id: row.id,
    name: String(row.name || "Серия / период"),
    status: String(row.status || "review"),
    productionFrom: row.productionFrom,
    productionTo: row.productionTo,
    evidenceVerified: evidence.verified,
    evidenceOfficial: evidence.official,
  };
}

export async function readStagingEncyclopediaCorpus() {
  if (!stagingCorpusCache) {
    stagingCorpusCache = (async () => {
      const root = stagingRoot();
      const manifest = await readLocalJson<StagingManifest>(path.join(root, "manifest.json"));
      if (manifest.schemaVersion !== 2 || manifest.workspace !== "vehicle-encyclopedia-v2") throw new Error("encyclopedia_staging_manifest_invalid");
      const [brands, models, generations, facelifts, variants] = await Promise.all([
        readStagingChunks<StagingBrand>(root, "brand", "brands-"),
        readStagingChunks<StagingModel>(root, "model", "models-"),
        readStagingChunks<StagingGeneration>(root, "generation", "generations-"),
        readStagingChunks<StagingGeneration>(root, "facelift", "facelifts-"),
        readStagingChunks<StagingVariant>(root, "variant", "variants-"),
      ]);
      for (const [entity, actual] of [["brand", brands.length], ["model", models.length], ["generation", generations.length], ["facelift", facelifts.length], ["variant", variants.length]] as const) {
        const expected = expectedStagingCount(manifest, entity);
        if (expected !== null && expected !== actual) throw new Error(`encyclopedia_staging_${entity}_count_mismatch:${actual}:${expected}`);
      }
      const generationById = new Map(generations.map((row) => [row.id, row]));
      const faceliftById = new Map(facelifts.map((row) => [row.id, row]));
      return {
        manifest,
        brands,
        models,
        variants: variants.map((row) => ({
          ...row,
          generation: generationMeta(row.generationId ? generationById.get(row.generationId) : undefined),
          facelift: generationMeta(row.faceliftId ? faceliftById.get(row.faceliftId) : undefined),
        })),
      };
    })();
  }
  return stagingCorpusCache;
}

function corpusVariantToKnowledge(
  row: VerifiedCorpusVariant,
  model: VerifiedCorpusModel,
  brandName: string,
): EncyclopediaKnowledgeVariant {
  return {
    id: row.id,
    modelId: row.modelId,
    make: canonicalCatalogBrand(brandName || model.brandId),
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
    encyclopediaEvidenceVerified: row.evidenceVerified ?? row.status === "verified",
    encyclopediaEvidenceOfficial: row.evidenceOfficial,
  };
}

function stagingVariantToKnowledge(row: StagingEncyclopediaCorpus["variants"][number], model: StagingModel, brandName: string): EncyclopediaKnowledgeVariant {
  const evidence = evidenceSummary(row.evidence);
  return {
    id: row.id,
    modelId: row.modelId,
    make: canonicalCatalogBrand(brandName || model.brandId),
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
    sourceIds: evidence.sourceIds,
    verifiedAt: row.updatedAt || "",
    active: true,
    generationMeta: row.generation || null,
    faceliftMeta: row.facelift || null,
    encyclopediaStatus: String(row.status || "review"),
    encyclopediaEvidenceVerified: evidence.verified,
    encyclopediaEvidenceOfficial: evidence.official,
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
      const encoded = (parts as VerifiedCorpusPart[]).sort((left, right) => left.part - right.part).map((part) => part.data).join("");
      const decoded = gunzipSync(Buffer.from(encoded, "base64"));
      if (decoded.byteLength !== Number(index.uncompressedBytes)) throw new Error(`verified_encyclopedia_corpus_size_mismatch:${decoded.byteLength}`);
      const digest = createHash("sha256").update(decoded).digest("hex");
      if (digest !== index.sha256) throw new Error(`verified_encyclopedia_corpus_sha_mismatch:${digest}`);
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
      readStagingEncyclopediaCorpus(),
    ]).then(([runtime, previewV2, verifiedCorpus, stagingCorpus]) => {
      const preview = previewV2.filter((row) => row?.id && row?.modelId && Number(row.powerHp) > 0) as EncyclopediaKnowledgeVariant[];
      const stagingBrands = new Map(stagingCorpus.brands.map((brand) => [brand.id, brand.canonicalName]));
      const stagingModels = new Map(stagingCorpus.models.map((model) => [model.id, model]));
      const staging = stagingCorpus.variants
        .filter((row) => row?.id && row?.modelId && stagingModels.has(row.modelId))
        .map((row) => {
          const model = stagingModels.get(row.modelId)!;
          return stagingVariantToKnowledge(row, model, stagingBrands.get(model.brandId) || model.brandId);
        });
      const verifiedModels = new Map(verifiedCorpus.models.map((model) => [model.id, model]));
      const verified = verifiedCorpus.variants
        .filter((row) => row?.id && row?.modelId && row.status === "verified" && verifiedModels.has(row.modelId))
        .map((row) => {
          const model = verifiedModels.get(row.modelId)!;
          return corpusVariantToKnowledge(row, model, stagingBrands.get(model.brandId) || model.brandId);
        });
      return mergeById(runtime as EncyclopediaKnowledgeVariant[], staging, preview, verified);
    });
  }
  return encyclopediaVariantCache;
}

export async function readEncyclopediaKnowledgeModels() {
  if (!encyclopediaModelCache) {
    encyclopediaModelCache = Promise.all([
      readVehicleKnowledgeModels(),
      readVerifiedEncyclopediaCorpus(),
      readStagingEncyclopediaCorpus(),
    ]).then(([runtime, verifiedCorpus, stagingCorpus]) => {
      const stagingBrands = new Map(stagingCorpus.brands.map((brand) => [brand.id, brand.canonicalName]));
      const stagingModels: EncyclopediaKnowledgeModel[] = stagingCorpus.models.map((model) => {
        const evidence = evidenceSummary(model.evidence);
        return {
          id: model.id,
          make: canonicalCatalogBrand(stagingBrands.get(model.brandId) || model.brandId),
          model: model.canonicalName,
          aliases: aliasValues(model.aliases, model.sourceNames),
          bodyTypes: model.bodyTypes || [],
          yearFrom: year(model.productionFrom),
          yearTo: year(model.productionTo),
          source: "manual" as const,
          sourceVersion: `Encyclopedia V2 staging ${stagingCorpus.manifest.lastCheckpoint || "checkpoint"}`,
          updatedAt: model.updatedAt || stagingCorpus.manifest.lastCheckpoint || "",
          active: true,
          encyclopediaStatus: String(model.status || "review"),
          encyclopediaEvidenceVerified: evidence.verified,
          encyclopediaEvidenceOfficial: evidence.official,
        };
      });
      const variantsByModel = new Map<string, VerifiedCorpusVariant[]>();
      for (const variant of verifiedCorpus.variants) {
        if (variant.status !== "verified") continue;
        const rows = variantsByModel.get(variant.modelId) || [];
        rows.push(variant);
        variantsByModel.set(variant.modelId, rows);
      }
      const verifiedModels: EncyclopediaKnowledgeModel[] = verifiedCorpus.models.flatMap((model) => {
        const variantDates = (variantsByModel.get(model.id) || []).map((row) => String(row.updatedAt || "")).filter(Boolean).sort();
        const updatedAt = variantDates.at(-1);
        if (!updatedAt) return [];
        return [{
          id: model.id,
          make: canonicalCatalogBrand(stagingBrands.get(model.brandId) || model.brandId),
          model: model.canonicalName,
          aliases: model.aliases || [],
          bodyTypes: model.bodyTypes || [],
          yearFrom: year(model.productionFrom),
          yearTo: year(model.productionTo),
          source: "manual" as const,
          sourceVersion: `Encyclopedia V2 verified corpus ${verifiedCorpus.sourceCheckpoint}`,
          updatedAt,
          active: true,
          encyclopediaStatus: model.status,
          encyclopediaEvidenceVerified: true,
        }];
      });
      const v2BrandKeys = new Set([...stagingModels, ...verifiedModels].map((model) => brandKey(model.make)));
      const runtimeFallback = runtime.filter((model) => !v2BrandKeys.has(brandKey(model.make))) as EncyclopediaKnowledgeModel[];
      return mergeById(runtimeFallback, stagingModels, verifiedModels);
    });
  }
  return encyclopediaModelCache;
}

export async function readEncyclopediaStats() {
  const [models, variants, verifiedCorpus, stagingCorpus] = await Promise.all([
    readEncyclopediaKnowledgeModels(),
    readEncyclopediaKnowledgeVariants(),
    readVerifiedEncyclopediaCorpus(),
    readStagingEncyclopediaCorpus(),
  ]);
  return {
    models: models.length,
    specifications: variants.length,
    verifiedV2Models: verifiedCorpus.totals.models,
    verifiedV2Specifications: verifiedCorpus.totals.variants,
    stagingV2Models: stagingCorpus.models.length,
    stagingV2Specifications: stagingCorpus.variants.length,
    sourceCheckpoint: verifiedCorpus.sourceCheckpoint,
    stagingCheckpoint: stagingCorpus.manifest.lastCheckpoint || null,
  };
}
