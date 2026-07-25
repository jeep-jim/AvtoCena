import type { MetadataRoute } from "next";
import { CATALOG_BRANDS } from "@/lib/catalog/brands";
import { readAllModelSeoLinks } from "@/lib/catalog/model-directory";

export const dynamic = "force-dynamic";
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = "https://avtocena.com";
  const lastModified = new Date();
  const staticPages: MetadataRoute.Sitemap = [
    { url: baseUrl, lastModified, changeFrequency: "daily", priority: 1 },
    { url: `${baseUrl}/cars`, lastModified, changeFrequency: "hourly", priority: 0.95 },
  ];
  const brandPages: MetadataRoute.Sitemap = CATALOG_BRANDS.map((brand) => ({
    url: `${baseUrl}/cars/brand/${brand.slug}`,
    lastModified,
    changeFrequency: "daily",
    priority: 0.8,
  }));
  const modelPages: MetadataRoute.Sitemap = (await readAllModelSeoLinks()).map((model) => ({
    url: `${baseUrl}/cars/brand/${model.brandSlug}/model/${model.modelSlug}`,
    lastModified: model.updatedAt ? new Date(model.updatedAt) : lastModified,
    changeFrequency: "daily",
    priority: 0.72,
  }));
  return [...staticPages, ...brandPages, ...modelPages];
}
