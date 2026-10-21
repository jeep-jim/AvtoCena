import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const WORKSPACE_ROOT = path.resolve(SCRIPT_DIR, "../../data/catalog/vehicle-encyclopedia-v2");
export const ENTITY_TYPES = ["source", "brand", "model", "generation", "facelift", "variant", "media"];

export function normalizeTerm(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/&/g, " and ")
    .replace(/\+/g, " plus ")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();
}

export function isPresent(value) {
  if (value === null || value === undefined || value === "") return false;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

export async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

export async function writeJson(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function loadWorkspace(root = WORKSPACE_ROOT) {
  const chunksDir = path.join(root, "chunks");
  const files = (await readdir(chunksDir))
    .filter((file) => /^(sources|brands|models|generations|facelifts|variants|media)-\d{4}\.json$/.test(file))
    .sort();
  const chunks = [];
  const records = Object.fromEntries(ENTITY_TYPES.map((type) => [type, []]));
  for (const file of files) {
    const absolute = path.join(chunksDir, file);
    const chunk = await readJson(absolute);
    chunks.push({ file, absolute, chunk });
    if (records[chunk.entityType] && Array.isArray(chunk.records)) records[chunk.entityType].push(...chunk.records);
  }
  return { root, chunksDir, chunks, records };
}

export function evidenceFields(entity) {
  const fields = new Map();
  for (const item of entity.evidence || []) {
    for (const field of item.fields || []) {
      const list = fields.get(field) || [];
      list.push(item);
      fields.set(field, list);
    }
  }
  return fields;
}

export function sourceDomain(source) {
  try {
    return new URL(source.url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "invalid";
  }
}

export function byId(rows) {
  return new Map(rows.map((row) => [row.id, row]));
}

export function brandForEntity(entity, indexes) {
  if (entity.brandId) return entity.brandId;
  if (entity.modelId) return indexes.models.get(entity.modelId)?.brandId || null;
  if (entity.generationId) {
    const modelId = indexes.generations.get(entity.generationId)?.modelId;
    return indexes.models.get(modelId)?.brandId || null;
  }
  return null;
}

export function modelForEntity(entity, indexes) {
  if (entity.modelId) return entity.modelId;
  if (entity.generationId) return indexes.generations.get(entity.generationId)?.modelId || null;
  return null;
}
