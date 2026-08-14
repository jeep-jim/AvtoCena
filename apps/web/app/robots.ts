import type { MetadataRoute } from "next";
import { aiCatalogManifestCount, readAiCatalogManifest } from "@/lib/ai-discovery";

const PRIVATE_PATHS = ["/crm/", "/api/", "/login", "/favorites", "/mcp"];
const CARS_PER_SITEMAP = 45_000;

export default async function robots(): Promise<MetadataRoute.Robots> {
  const manifest = await readAiCatalogManifest().catch(() => ({ generationId: "", markets: {} }));
  const offerCount = aiCatalogManifestCount(manifest);
  const offerSitemapCount = Math.ceil(offerCount / CARS_PER_SITEMAP);
  const sitemaps = [
    "https://avtocena.com/sitemap.xml",
    ...Array.from({ length: offerSitemapCount }, (_, id) => `https://avtocena.com/cars/sitemap/${id}.xml`),
  ];

  return {
    rules: [
      {
        userAgent: "OAI-SearchBot",
        allow: "/",
        disallow: PRIVATE_PATHS,
      },
      {
        userAgent: "ChatGPT-User",
        allow: "/",
        disallow: PRIVATE_PATHS,
      },
      {
        userAgent: "GPTBot",
        allow: "/",
        disallow: PRIVATE_PATHS,
      },
      {
        userAgent: "*",
        allow: "/",
        disallow: PRIVATE_PATHS,
      },
    ],
    sitemap: sitemaps,
    host: "https://avtocena.com",
  };
}
