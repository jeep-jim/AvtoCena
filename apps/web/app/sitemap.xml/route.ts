import {SEARCH_MARKETS} from '@/lib/catalog/search-metadata';
import { readCatalogBrandDirectory } from "@/lib/catalog/catalog-brand-directory";

export const dynamic = "force-dynamic";

function xmlEscape(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function urlEntry(url: string, changefreq: string, priority: number) {
  return [
    "  <url>",
    `    <loc>${xmlEscape(url)}</loc>`,
    `    <changefreq>${changefreq}</changefreq>`,
    `    <priority>${priority}</priority>`,
    "  </url>",
  ].join("\n");
}

export async function GET() {
  const baseUrl = "https://avtocena.com";
  const brands = await readCatalogBrandDirectory();
  const entries = [
    urlEntry(baseUrl, "daily", 1),
    ...["privacy","consent","cookies","requisites","terms"].map(path=>urlEntry(`${baseUrl}/${path}`,"monthly",0.3)),
    urlEntry(`${baseUrl}/cars`, "hourly", 0.95),
    ...Object.keys(SEARCH_MARKETS).map(market=>urlEntry(`${baseUrl}/cars/${market}`,"daily",0.9)),
    urlEntry(`${baseUrl}/cars/green`, "daily", 0.8),
    urlEntry(`${baseUrl}/dealers`, "weekly", 0.7),
    urlEntry(`${baseUrl}/cars/autocatalog`, "daily", 0.9),
    ...brands.map((brand) => urlEntry(`${baseUrl}/cars/brand/${brand.slug}`, "daily", 0.8)),
  ];

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    entries.join("\n"),
    "</urlset>",
    "",
  ].join("\n");

  return new Response(xml, {
    status: 200,
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "cache-control": "public, max-age=300, s-maxage=300, stale-while-revalidate=3600",
    },
  });
}
