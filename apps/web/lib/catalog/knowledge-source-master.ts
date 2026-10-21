import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { getDataRoot } from "../data";
import { canonicalCatalogBrand } from "./brands";

const SOURCE_MASTER_ROOT = path.join("catalog", "knowledge-source-snapshots", "master");

export type KnowledgeSourceMasterManifest = {
  schemaVersion?: number;
  id?: string;
  builtAt?: string;
  status?: string;
  counts?: {
    brands?: number;
    models?: number;
    modelsWithKnownMake?: number;
    modelsWithCanonicalV2?: number;
    modelsWithImageUrl?: number;
  };
};

export type KnowledgeSourceMasterModel = {
  sourceKey?: string;
  make?: string | null;
  model?: string | null;
  aliases?: string[];
  sourceNames?: string[];
  markets?: string[];
  sources?: string[];
  origins?: string[];
  yearFrom?: number | null;
  yearTo?: number | null;
  bodyTypes?: string[];
  imageUrls?: string[];
  canonical?: {
    brandId?: string | null;
    modelId?: string | null;
    canonicalMake?: string | null;
    canonicalModel?: string | null;
  } | null;
};

export type KnowledgeSourceMaster = {
  manifest: KnowledgeSourceMasterManifest;
  models: KnowledgeSourceMasterModel[];
};

export type SourceBackedEncyclopediaModel = {
  id: string;
  make: string;
  model: string;
  aliases: string[];
  bodyTypes: string[];
  regions: string[];
  yearFrom?: number;
  yearTo?: number;
  source: "manual";
  sourceVersion: string;
  updatedAt: string;
  active: true;
  sourceBacked: true;
  sourceKey?: string;
  sourceIds: string[];
  sourceOrigins: string[];
  modelBoundImageCandidates: string[];
  canonicalModelId?: string;
};

let sourceMasterCache: Promise<KnowledgeSourceMaster> | null = null;
let sourceBackedModelsCache: Promise<SourceBackedEncyclopediaModel[]> | null = null;

function clean(value: unknown) {
  return String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
}

function unique(values: unknown[]) {
  return [...new Set(values.map(clean).filter(Boolean))];
}

function modelWithoutLeadingMake(model: unknown, make: unknown) {
  const modelText = clean(model);
  const makeText = clean(make);
  if (!modelText || !makeText) return "";
  const escapedMake = makeText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const stripped = modelText.replace(new RegExp(`^${escapedMake}(?:\\s+|[-_/]+)`, "i"), "").trim();
  return stripped && stripped !== modelText ? stripped : "";
}

function positiveYear(value: unknown) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 1886 && number <= 2100 ? number : undefined;
}

function modelIdentity(make: string, model: string) {
  return `${make.toLocaleLowerCase("en-US")}\u0000${model.toLocaleLowerCase("en-US")}`;
}

function stableSourceModelId(make: string, model: string) {
  return `source-master/${createHash("sha256").update(modelIdentity(make, model)).digest("hex").slice(0, 20)}`;
}

function sourceMasterRoot() {
  const dataRoot = path.resolve(getDataRoot());
  const root = path.resolve(dataRoot, SOURCE_MASTER_ROOT);
  if (!root.startsWith(`${dataRoot}${path.sep}`)) throw new Error("knowledge_source_master_invalid_root");
  return root;
}

export async function readKnowledgeSourceMaster(): Promise<KnowledgeSourceMaster> {
  if (!sourceMasterCache) {
    sourceMasterCache = (async () => {
      const root = sourceMasterRoot();
      const manifest = JSON.parse(await fs.readFile(path.join(root, "manifest.json"), "utf8")) as KnowledgeSourceMasterManifest;
      if (manifest.status !== "source_master_built") throw new Error("knowledge_source_master_not_ready");
      const names = (await fs.readdir(root)).filter((name) => /^models-\d+\.json$/.test(name)).sort();
      if (!names.length) throw new Error("knowledge_source_master_model_chunks_missing");
      const chunks = await Promise.all(names.map(async (name) => {
        const payload = JSON.parse(await fs.readFile(path.join(root, name), "utf8"));
        if (payload?.entityType !== "source_master_model" || !Array.isArray(payload?.records)) {
          throw new Error(`knowledge_source_master_invalid_chunk:${name}`);
        }
        return payload.records as KnowledgeSourceMasterModel[];
      }));
      const models = chunks.flat();
      const expected = Number(manifest.counts?.models || 0);
      if (expected > 0 && models.length !== expected) throw new Error(`knowledge_source_master_count_mismatch:${models.length}:${expected}`);
      return { manifest, models };
    })();
  }
  return sourceMasterCache;
}

/**
 * Product-safe read layer for the saved 20k source corpus.
 *
 * Source-backed identities are allowed to exist before a canonical V2 link is
 * known. They carry source provenance and names only; this layer never invents
 * technical facts, never turns an observation year into a model year and never
 * promotes an image URL to a verified photo.
 */
export async function readSourceBackedEncyclopediaModels(): Promise<SourceBackedEncyclopediaModel[]> {
  if (!sourceBackedModelsCache) {
    sourceBackedModelsCache = readKnowledgeSourceMaster().then(({ manifest, models }) => {
      const merged = new Map<string, SourceBackedEncyclopediaModel>();
      for (const row of models) {
        const rawMake = clean(row.canonical?.canonicalMake || row.make);
        const rawModel = clean(row.canonical?.canonicalModel || row.model);
        if (!rawMake || !rawModel) continue;
        const make = canonicalCatalogBrand(rawMake);
        const model = rawModel;
        const key = modelIdentity(make, model);
        const canonicalModelId = clean(row.canonical?.modelId) || undefined;
        const current = merged.get(key);
        const next: SourceBackedEncyclopediaModel = {
          id: canonicalModelId || current?.id || stableSourceModelId(make, model),
          make,
          model,
          aliases: unique([
            ...(current?.aliases || []),
            modelWithoutLeadingMake(row.model, make),
            clean(row.model) !== model ? row.model : "",
            ...(row.aliases || []),
            ...(row.sourceNames || []),
          ]),
          bodyTypes: unique([...(current?.bodyTypes || []), ...(row.bodyTypes || [])]),
          regions: unique([...(current?.regions || []), ...(row.markets || [])]),
          yearFrom: current?.yearFrom || positiveYear(row.yearFrom),
          yearTo: current?.yearTo || positiveYear(row.yearTo),
          source: "manual",
          sourceVersion: `Knowledge source master ${manifest.builtAt || "saved corpus"}`,
          updatedAt: manifest.builtAt || "",
          active: true,
          sourceBacked: true,
          sourceKey: current?.sourceKey || clean(row.sourceKey) || undefined,
          sourceIds: unique([...(current?.sourceIds || []), ...(row.sources || [])]),
          sourceOrigins: unique([...(current?.sourceOrigins || []), ...(row.origins || [])]),
          modelBoundImageCandidates: unique([...(current?.modelBoundImageCandidates || []), ...(row.imageUrls || [])]),
          canonicalModelId: canonicalModelId || current?.canonicalModelId,
        };
        const from = [current?.yearFrom, positiveYear(row.yearFrom)].filter((value): value is number => Boolean(value));
        const to = [current?.yearTo, positiveYear(row.yearTo)].filter((value): value is number => Boolean(value));
        if (from.length) next.yearFrom = Math.min(...from);
        if (to.length) next.yearTo = Math.max(...to);
        merged.set(key, next);
      }
      return [...merged.values()].sort((left, right) => `${left.make} ${left.model}`.localeCompare(`${right.make} ${right.model}`, "ru"));
    });
  }
  return sourceBackedModelsCache;
}

export function resetKnowledgeSourceMasterForTests() {
  sourceMasterCache = null;
  sourceBackedModelsCache = null;
}
