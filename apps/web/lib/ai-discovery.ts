import { gzipSync } from "node:zlib";
import { getJsonStorage, readDataJson } from "./data";
import type { CatalogSearchProjection } from "./catalog/storage";

export const AVTOCENA_PUBLIC_ORIGIN = "https://avtocena.com";
export const AI_CATALOG_PROJECTION_PATH = "catalog/public/projection/all.json";
export const AI_PRODUCT_FEED_PATH = "catalog/public/feeds/openai-products.csv.gz";
export const AI_PRODUCT_FEED_METADATA_PATH = "catalog/public/feeds/openai-products.json";
export const AI_PRODUCT_FEED_HEADER = [
  "id",
  "title",
  "description",
  "link",
  "image_link",
  "availability",
  "price",
  "brand",
  "identifier_exists",
  "product_type",
];

export type AiCatalogProjection = {
  generationId: string;
  items: CatalogSearchProjection[];
};

export type AiCatalogManifest = {
  version?: number;
  generationId: string;
  updatedAt?: string;
  markets: Record<string, { count?: number; updatedAt?: string }>;
};

export async function readAiCatalogProjection(): Promise<AiCatalogProjection> {
  const projection = await readDataJson<AiCatalogProjection>(AI_CATALOG_PROJECTION_PATH, {
    generationId: "",
    items: [],
  });

  return {
    generationId: String(projection.generationId || ""),
    items: Array.isArray(projection.items)
      ? projection.items.filter((item) => Boolean(item?.id && item?.make && item?.model && item?.year))
      : [],
  };
}

export async function readAiCatalogManifest(): Promise<AiCatalogManifest> {
  return readDataJson<AiCatalogManifest>("catalog/manifest.json", {
    generationId: "",
    markets: {},
  });
}

export function aiCatalogManifestCount(manifest: AiCatalogManifest) {
  return Object.values(manifest.markets || {}).reduce((sum, market) => sum + Math.max(0, Number(market?.count || 0)), 0);
}

export function absoluteAvtocenaUrl(value: unknown) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    return new URL(raw, AVTOCENA_PUBLIC_ORIGIN).toString();
  } catch {
    return "";
  }
}

export function catalogOfferUrl(id: unknown) {
  const normalized = String(id || "").trim();
  return normalized ? `${AVTOCENA_PUBLIC_ORIGIN}/cars/offer/${encodeURIComponent(normalized)}` : "";
}

export function aiCatalogTitle(item: Pick<CatalogSearchProjection, "make" | "model" | "trim" | "year">) {
  return [item.make, item.model, item.trim, item.year].map((part) => String(part || "").trim()).filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

export function aiCatalogDescription(item: CatalogSearchProjection) {
  const parts = [
    aiCatalogTitle(item),
    item.market ? `рынок: ${item.market}` : "",
    Number(item.mileageKm || 0) > 0 ? `пробег: ${Math.round(Number(item.mileageKm))} км` : "",
    Number(item.engineCc || 0) > 0 ? `двигатель: ${Math.round(Number(item.engineCc))} см³` : "",
    item.fuel ? `топливо: ${item.fuel}` : "",
    item.transmission ? `КПП: ${item.transmission}` : "",
    item.drive ? `привод: ${item.drive}` : "",
    Number(item.power30MinKw || 0) > 0 ? `30-минутная мощность: ${Number(item.power30MinKw)} кВт` : "",
  ].filter(Boolean);

  return `${parts.join("; ")}. Стоимость указана по расчёту АвтоЦены под ключ и должна подтверждаться в актуальной карточке автомобиля.`.slice(0, 5000);
}


export type AiProductFeedMetadata = {
  version: 1;
  generationId: string;
  updatedAt: string;
  objectPath: string;
  productCount: number;
  size: number;
  checksum: string;
  format: "google-compatible-csv-gzip";
};

function csvCell(value: unknown) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

export function buildAiProductFeed(projection: AiCatalogProjection) {
  const rows = projection.items
    .filter((item) => Number(item.totalRub || item.publicVisibleRub || 0) > 0 && Boolean(item.cardImageUrl))
    .map((item) => {
      const priceRub = Math.round(Number(item.totalRub || item.publicVisibleRub || 0));
      return [
        item.id,
        aiCatalogTitle(item).slice(0, 150),
        aiCatalogDescription(item).slice(0, 5000),
        catalogOfferUrl(item.id),
        absoluteAvtocenaUrl(item.cardImageUrl),
        "in_stock",
        `${priceRub} RUB`,
        item.make,
        "no",
        "Vehicles > Cars",
      ].map(csvCell).join(",");
    });

  const body = `\uFEFF${AI_PRODUCT_FEED_HEADER.join(",")}\n${rows.join("\n")}\n`;
  return {
    data: gzipSync(Buffer.from(body, "utf8"), { level: 9 }),
    productCount: rows.length,
  };
}

export async function publishAiProductFeed(projection: AiCatalogProjection): Promise<AiProductFeedMetadata> {
  const storage = getJsonStorage();
  if (!storage.putBinary) throw new Error("ai_product_feed_binary_storage_unavailable");
  const built = buildAiProductFeed(projection);
  const stored = await storage.putBinary(AI_PRODUCT_FEED_PATH, built.data, "application/gzip");
  const metadata: AiProductFeedMetadata = {
    version: 1,
    generationId: projection.generationId,
    updatedAt: new Date().toISOString(),
    objectPath: AI_PRODUCT_FEED_PATH,
    productCount: built.productCount,
    size: stored.size,
    checksum: stored.checksum,
    format: "google-compatible-csv-gzip",
  };
  await storage.writeJson(AI_PRODUCT_FEED_METADATA_PATH, metadata);
  return metadata;
}

export async function ensureAiProductFeed(projection: AiCatalogProjection): Promise<AiProductFeedMetadata> {
  const storage = getJsonStorage();
  const current = await storage.readJson<AiProductFeedMetadata | null>(AI_PRODUCT_FEED_METADATA_PATH, null);
  const currentObjectExists = current?.objectPath === AI_PRODUCT_FEED_PATH
    && Boolean(await storage.binaryExists?.(AI_PRODUCT_FEED_PATH).catch(() => false));
  if (current?.version === 1 && current.generationId === projection.generationId && currentObjectExists) return current;
  return publishAiProductFeed(projection);
}
