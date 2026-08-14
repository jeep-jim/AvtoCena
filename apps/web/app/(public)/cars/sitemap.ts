import type { MetadataRoute } from "next";
import { aiCatalogManifestCount, catalogOfferUrl, readAiCatalogManifest, readAiCatalogProjection } from "@/lib/ai-discovery";

export const dynamic = "force-dynamic";
export const revalidate = 3600;

const CARS_PER_SITEMAP = 45_000;

export async function generateSitemaps() {
  try {
    const manifest = await readAiCatalogManifest();
    const total = aiCatalogManifestCount(manifest);
    const count = Math.max(1, Math.ceil(total / CARS_PER_SITEMAP));
    return Array.from({ length: count }, (_, id) => ({ id }));
  } catch {
    return [{ id: 0 }];
  }
}

export default async function sitemap({ id }: { id: number }): Promise<MetadataRoute.Sitemap> {
  const projection = await readAiCatalogProjection();
  const start = Math.max(0, Number(id || 0)) * CARS_PER_SITEMAP;
  const rows = projection.items.slice(start, start + CARS_PER_SITEMAP);

  return rows.map((item) => ({
    url: catalogOfferUrl(item.id),
    lastModified: item.updatedAt ? new Date(item.updatedAt) : new Date(),
    changeFrequency: "hourly" as const,
    priority: 0.68,
    images: item.cardImageUrl ? [item.cardImageUrl] : undefined,
  }));
}
