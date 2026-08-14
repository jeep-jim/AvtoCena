import { readDataJson } from "./data";
import type { CatalogSearchProjection } from "./catalog/storage";

export const AVTOCENA_PUBLIC_ORIGIN = "https://avtocena.com";
export const AI_CATALOG_PROJECTION_PATH = "catalog/public/projection/all.json";

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
