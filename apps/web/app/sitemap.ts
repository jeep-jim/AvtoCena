import type { MetadataRoute } from "next";
import { CATALOG_BRANDS } from "@/lib/catalog/brands";

export default function sitemap(): MetadataRoute.Sitemap {
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
  return [...staticPages, ...brandPages];
}
