import fs from "node:fs/promises";
import path from "node:path";
import { getDataRoot } from "../data";
import {
  EncyclopediaIdentityResolver,
  type EncyclopediaBrandIdentity,
  type EncyclopediaModelIdentity,
  type EncyclopediaSearchIdentityEntry,
} from "./encyclopedia-identity";

type EncyclopediaManifest = {
  schemaVersion?: number;
  workspace?: string;
  productionConnected?: boolean;
  collections?: Record<string, { records?: number }>;
};

type EntityChunk<T> = {
  schemaVersion?: number;
  entityType?: string;
  records?: T[];
};

type SearchIndex = {
  schemaVersion?: number;
  entries?: EncyclopediaSearchIdentityEntry[];
};

export type EncyclopediaIdentityDataset = {
  manifest: EncyclopediaManifest;
  brands: EncyclopediaBrandIdentity[];
  models: EncyclopediaModelIdentity[];
  searchEntries: EncyclopediaSearchIdentityEntry[];
};

const ROOT = "catalog/vehicle-encyclopedia-v2";
let resolverCache: Promise<EncyclopediaIdentityResolver | null> | null = null;

function safeRoot() {
  const dataRoot = path.resolve(getDataRoot());
  const target = path.resolve(dataRoot, ROOT);
  if (!target.startsWith(`${dataRoot}${path.sep}`)) throw new Error("encyclopedia_identity_invalid_root");
  return target;
}

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await fs.readFile(file, "utf8")) as T;
}

async function readEntityChunks<T>(root: string, entity: "brand" | "model") {
  const directory = path.join(root, "chunks");
  const prefix = entity === "brand" ? "brands-" : "models-";
  const names = (await fs.readdir(directory))
    .filter((name) => name.startsWith(prefix) && name.endsWith(".json"))
    .sort((left, right) => left.localeCompare(right, "en"));
  const records: T[] = [];
  for (const name of names) {
    const chunk = await readJson<EntityChunk<T>>(path.join(directory, name));
    if (chunk.schemaVersion !== 2 || chunk.entityType !== entity || !Array.isArray(chunk.records)) {
      throw new Error(`encyclopedia_identity_invalid_${entity}_chunk:${name}`);
    }
    if (chunk.records.length > 250) throw new Error(`encyclopedia_identity_chunk_overflow:${name}:${chunk.records.length}`);
    records.push(...chunk.records);
  }
  return records;
}

function expectedCount(manifest: EncyclopediaManifest, entity: "brand" | "model") {
  const value = Number(manifest.collections?.[entity]?.records);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function nonEmpty(value: unknown) {
  return typeof value === "string" && Boolean(value.trim());
}

function validIdentityAlias(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const alias = value as { value?: unknown; kind?: unknown; safe?: unknown; sourceIds?: unknown };
  return nonEmpty(alias.value)
    && nonEmpty(alias.kind)
    && typeof alias.safe === "boolean"
    && Array.isArray(alias.sourceIds)
    && alias.sourceIds.length > 0
    && alias.sourceIds.every(nonEmpty);
}

function validateIdentityRecords(brands: EncyclopediaBrandIdentity[], models: EncyclopediaModelIdentity[]) {
  const brandIds = new Set<string>();
  for (const brand of brands) {
    if (!nonEmpty(brand?.id) || !nonEmpty(brand?.canonicalName)) throw new Error("encyclopedia_identity_invalid_brand_record");
    if (brandIds.has(brand.id)) throw new Error(`encyclopedia_identity_duplicate_brand_id:${brand.id}`);
    brandIds.add(brand.id);
    if (!Array.isArray(brand.aliases) || !brand.aliases.every(validIdentityAlias)) {
      throw new Error(`encyclopedia_identity_invalid_brand_aliases:${brand.id}`);
    }
  }

  const modelIds = new Set<string>();
  for (const model of models) {
    if (!nonEmpty(model?.id) || !nonEmpty(model?.brandId) || !nonEmpty(model?.canonicalName)) {
      throw new Error("encyclopedia_identity_invalid_model_record");
    }
    if (!brandIds.has(model.brandId)) throw new Error(`encyclopedia_identity_model_brand_missing:${model.id}:${model.brandId}`);
    if (modelIds.has(model.id)) throw new Error(`encyclopedia_identity_duplicate_model_id:${model.id}`);
    modelIds.add(model.id);
    if (!Array.isArray(model.aliases) || !model.aliases.every(validIdentityAlias)) {
      throw new Error(`encyclopedia_identity_invalid_model_aliases:${model.id}`);
    }
    if (model.sourceNames !== undefined && (!Array.isArray(model.sourceNames) || !model.sourceNames.every(validIdentityAlias))) {
      throw new Error(`encyclopedia_identity_invalid_model_source_names:${model.id}`);
    }
  }
  return { brandIds, modelIds };
}

function validateSearchEntries(
  entries: EncyclopediaSearchIdentityEntry[],
  brandIds: Set<string>,
  modelIds: Set<string>,
) {
  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || !nonEmpty(entry.term) || typeof entry.safe !== "boolean" || !nonEmpty(entry.entityType)) {
      throw new Error("encyclopedia_identity_invalid_search_entry");
    }
    if (!entry.safe) continue;
    if (entry.entityType === "brand") {
      if (!entry.brandId || !brandIds.has(entry.brandId)) throw new Error(`encyclopedia_identity_search_brand_missing:${entry.entityId}`);
    }
    if (entry.entityType === "model") {
      if (!entry.brandId || !brandIds.has(entry.brandId) || !entry.modelId || !modelIds.has(entry.modelId)) {
        throw new Error(`encyclopedia_identity_search_model_missing:${entry.entityId}`);
      }
    }
  }
}

export async function readEncyclopediaIdentityDataset(): Promise<EncyclopediaIdentityDataset | null> {
  const root = safeRoot();
  try {
    const manifest = await readJson<EncyclopediaManifest>(path.join(root, "manifest.json"));
    if (manifest.schemaVersion !== 2 || manifest.workspace !== "vehicle-encyclopedia-v2") return null;

    const [brands, models, search] = await Promise.all([
      readEntityChunks<EncyclopediaBrandIdentity>(root, "brand"),
      readEntityChunks<EncyclopediaModelIdentity>(root, "model"),
      readJson<SearchIndex>(path.join(root, "generated", "search-index.json")),
    ]);
    if (search.schemaVersion !== 2 || !Array.isArray(search.entries)) throw new Error("encyclopedia_identity_invalid_search_index");

    const expectedBrands = expectedCount(manifest, "brand");
    const expectedModels = expectedCount(manifest, "model");
    if (expectedBrands !== null && brands.length !== expectedBrands) {
      throw new Error(`encyclopedia_identity_brand_count_mismatch:${brands.length}:${expectedBrands}`);
    }
    if (expectedModels !== null && models.length !== expectedModels) {
      throw new Error(`encyclopedia_identity_model_count_mismatch:${models.length}:${expectedModels}`);
    }

    const identities = validateIdentityRecords(brands, models);
    validateSearchEntries(search.entries, identities.brandIds, identities.modelIds);
    return { manifest, brands, models, searchEntries: search.entries };
  } catch (error: any) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

export async function readEncyclopediaIdentityResolver() {
  if (!resolverCache) {
    resolverCache = readEncyclopediaIdentityDataset().then((dataset) => {
      if (!dataset) return null;
      return new EncyclopediaIdentityResolver({
        brands: dataset.brands,
        models: dataset.models,
        searchEntries: dataset.searchEntries,
      });
    });
  }
  return resolverCache;
}

export function resetEncyclopediaIdentityResolverCache() {
  resolverCache = null;
}
