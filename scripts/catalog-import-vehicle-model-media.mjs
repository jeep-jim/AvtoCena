import fs from "node:fs/promises";

const { readChunkedDataJson, writeDataJson } = await import("../apps/web/lib/data.ts");

const INPUT = process.env.VEHICLE_MODEL_MEDIA_INPUT;
const OUTPUT = "catalog/vehicle-knowledge/model-media.json";
const MAX_IMAGES = Math.max(1, Math.min(12, Number(process.env.VEHICLE_MODEL_MEDIA_MAX_IMAGES || 12)));
const YEAR_FLOOR = new Date().getFullYear() - 15 + 1;

if (!INPUT) throw new Error("VEHICLE_MODEL_MEDIA_INPUT is required");

function text(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function validUrl(value) {
  try {
    const url = new URL(text(value));
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function year(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= YEAR_FLOOR && parsed <= new Date().getFullYear() + 2 ? parsed : undefined;
}

function normalizeImage(image, fallbackSourceUrl) {
  const url = text(image?.url || image?.src || image?.imageUrl || image?.photoUrl);
  const sourceUrl = text(image?.sourceUrl || fallbackSourceUrl);
  if (!validUrl(url) || !validUrl(sourceUrl)) return null;
  return {
    url,
    sourceUrl,
    sourceId: text(image?.sourceId) || undefined,
    alt: text(image?.alt) || undefined,
    view: ["front", "rear", "side", "interior", "detail", "other"].includes(image?.view) ? image.view : "other",
    width: Number(image?.width) > 0 ? Number(image.width) : undefined,
    height: Number(image?.height) > 0 ? Number(image.height) : undefined,
  };
}

function normalizeRow(row) {
  const sourceUrl = text(row?.sourceUrl);
  const yearFrom = year(row?.yearFrom);
  const yearTo = year(row?.yearTo);
  if (Number(row?.yearTo || 0) && !yearTo) return null;
  if (!text(row?.id) || !text(row?.modelId) || !text(row?.make) || !text(row?.model) || !validUrl(sourceUrl)) return null;
  const seen = new Set();
  const images = (Array.isArray(row?.images) ? row.images : [])
    .map((image) => normalizeImage(image, sourceUrl))
    .filter(Boolean)
    .filter((image) => {
      const key = image.url.replace(/[?#].*$/, "");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_IMAGES);
  if (!images.length) return null;
  return {
    id: text(row.id),
    modelId: text(row.modelId),
    make: text(row.make),
    model: text(row.model),
    generation: text(row.generation) || undefined,
    yearFrom,
    yearTo,
    images,
    sourceType: ["manufacturer", "official_catalog", "trusted_catalog", "manual"].includes(row.sourceType) ? row.sourceType : "trusted_catalog",
    sourceUrl,
    verifiedAt: text(row.verifiedAt) || new Date().toISOString(),
    active: row.active !== false,
  };
}

const payload = JSON.parse(await fs.readFile(INPUT, "utf8"));
const incoming = (Array.isArray(payload) ? payload : payload?.items || []).map(normalizeRow).filter(Boolean);
const existing = await readChunkedDataJson(OUTPUT, []);
const merged = new Map(existing.map((row) => [row.id, row]));
for (const row of incoming) merged.set(row.id, row);
const rows = [...merged.values()].filter((row) => row?.active !== false).sort((a, b) => `${a.make} ${a.model} ${a.generation || ""}`.localeCompare(`${b.make} ${b.model} ${b.generation || ""}`, "ru"));
await writeDataJson(OUTPUT, rows);
console.log(JSON.stringify({ imported: incoming.length, total: rows.length, yearFloor: YEAR_FLOOR, maxImages: MAX_IMAGES }, null, 2));
