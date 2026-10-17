import { getJsonStorage } from "../data";

const MANIFEST_PATH = "catalog/autocatalog/v1/manifest.json";
const CACHE_TTL_MS = 5 * 60 * 1_000;

export type AutocatalogPublishedCover = {
  id: string;
  modelId: string;
  modelName?: string;
  objectKey: string;
  sourceId?: string;
  originalUrl: string;
  pageUrl: string;
  source?: string;
  license: string;
  attribution: string;
  width?: number;
  height?: number;
  size?: number;
  sha256: string;
};

type AutocatalogPublicationManifest = {
  schemaVersion?: number;
  covers?: AutocatalogPublishedCover[];
};

let manifestCache: { expiresAt: number; value: AutocatalogPublicationManifest } | null = null;

function safeCover(row: AutocatalogPublishedCover) {
  return Boolean(
    row?.id
      && row?.modelId
      && /^catalog\/autocatalog\/v1\/media\/model-covers\/[a-f0-9]{64}\.webp$/.test(String(row.objectKey || ""))
      && /^[a-f0-9]{64}$/.test(String(row.sha256 || ""))
      && /^https:\/\/commons\.wikimedia\.org\//i.test(String(row.pageUrl || ""))
      && /^(?:CC0|CC BY(?:-SA)?|Public domain)\b/i.test(String(row.license || "")),
  );
}

export function autocatalogCoverUrl(row: AutocatalogPublishedCover) {
  const cdn = process.env.CATALOG_IMAGE_CDN_URL?.replace(/\/+$/g, "");
  return cdn ? `${cdn}/${row.objectKey}` : `/api/catalog/autocatalog-cover/${row.sha256}`;
}

export async function readAutocatalogPublishedCovers() {
  if (manifestCache && manifestCache.expiresAt > Date.now()) return manifestCache.value.covers || [];
  const manifest = await getJsonStorage().readJson<AutocatalogPublicationManifest>(MANIFEST_PATH, { schemaVersion: 1, covers: [] });
  const value = {
    schemaVersion: manifest.schemaVersion,
    covers: (Array.isArray(manifest.covers) ? manifest.covers : []).filter(safeCover),
  };
  manifestCache = { expiresAt: Date.now() + CACHE_TTL_MS, value };
  return value.covers;
}

export async function readAutocatalogCoverIndex() {
  return new Map((await readAutocatalogPublishedCovers()).map((cover) => [cover.modelId, cover]));
}

export async function findAutocatalogPublishedCover(modelId: string) {
  return (await readAutocatalogPublishedCovers()).find((cover) => cover.modelId === modelId) || null;
}

export function resetAutocatalogPublicationCache() {
  manifestCache = null;
}
