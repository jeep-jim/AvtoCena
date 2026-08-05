import { readChunkedDataJson } from "../data";

export type VehicleModelImage = {
  url: string;
  sourceUrl: string;
  sourceId?: string;
  alt?: string;
  view?: "front" | "rear" | "side" | "interior" | "detail" | "other";
  width?: number;
  height?: number;
};

export type VehicleModelMedia = {
  id: string;
  modelId: string;
  make: string;
  model: string;
  generation?: string;
  yearFrom?: number;
  yearTo?: number;
  images: VehicleModelImage[];
  sourceType: "manufacturer" | "official_catalog" | "trusted_catalog" | "manual";
  sourceUrl: string;
  verifiedAt: string;
  active?: boolean;
};

const MODEL_MEDIA_PATH = "catalog/vehicle-knowledge/model-media.json";
const MAX_MODEL_IMAGES = 12;
let mediaCache: Promise<VehicleModelMedia[]> | null = null;

function text(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function positiveYear(value: unknown) {
  const year = Number(value);
  return Number.isInteger(year) && year >= 2011 && year <= new Date().getFullYear() + 2 ? year : undefined;
}

function isHttpUrl(value: unknown) {
  try {
    const url = new URL(text(value));
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function normalizeImage(image: VehicleModelImage): VehicleModelImage | null {
  if (!isHttpUrl(image?.url) || !isHttpUrl(image?.sourceUrl)) return null;
  const width = Number(image.width || 0);
  const height = Number(image.height || 0);
  return {
    url: text(image.url),
    sourceUrl: text(image.sourceUrl),
    sourceId: text(image.sourceId) || undefined,
    alt: text(image.alt) || undefined,
    view: image.view || "other",
    width: Number.isFinite(width) && width > 0 ? width : undefined,
    height: Number.isFinite(height) && height > 0 ? height : undefined,
  };
}

function normalizeMedia(row: VehicleModelMedia): VehicleModelMedia | null {
  if (!row?.id || !row?.modelId || !text(row.make) || !text(row.model) || !isHttpUrl(row.sourceUrl)) return null;
  const seen = new Set<string>();
  const images = (Array.isArray(row.images) ? row.images : [])
    .map(normalizeImage)
    .filter((image): image is VehicleModelImage => Boolean(image))
    .filter((image) => {
      const key = image.url.replace(/[?#].*$/, "");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_MODEL_IMAGES);
  if (!images.length) return null;
  return {
    ...row,
    make: text(row.make),
    model: text(row.model),
    generation: text(row.generation) || undefined,
    yearFrom: positiveYear(row.yearFrom),
    yearTo: positiveYear(row.yearTo),
    images,
    sourceUrl: text(row.sourceUrl),
    verifiedAt: text(row.verifiedAt),
  };
}

export async function readVehicleModelMedia() {
  if (!mediaCache) {
    mediaCache = readChunkedDataJson<VehicleModelMedia>(MODEL_MEDIA_PATH, [])
      .then((rows) => rows
        .filter((row) => row?.active !== false)
        .map(normalizeMedia)
        .filter((row): row is VehicleModelMedia => Boolean(row)));
  }
  return mediaCache;
}

export async function findVehicleModelMedia(modelId: string, year?: number, generation?: string) {
  const requestedYear = Number(year || 0);
  const requestedGeneration = text(generation).toLocaleLowerCase("ru-RU");
  const rows = (await readVehicleModelMedia()).filter((row) => row.modelId === modelId);
  const ranked = rows
    .map((row) => {
      if (requestedYear && row.yearFrom && requestedYear < row.yearFrom) return null;
      if (requestedYear && row.yearTo && requestedYear > row.yearTo) return null;
      let score = 10;
      if (requestedYear && (row.yearFrom || row.yearTo)) score += 10;
      if (requestedGeneration && text(row.generation).toLocaleLowerCase("ru-RU") === requestedGeneration) score += 20;
      return { row, score };
    })
    .filter((entry): entry is { row: VehicleModelMedia; score: number } => Boolean(entry))
    .sort((left, right) => right.score - left.score || Date.parse(right.row.verifiedAt) - Date.parse(left.row.verifiedAt));
  return ranked[0]?.row || null;
}

export function resetVehicleModelMediaCache() {
  mediaCache = null;
}
