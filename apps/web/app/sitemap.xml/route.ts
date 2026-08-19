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
    `    <lastmod>${new Date().toISOString()}</lastmod>`,
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
    urlEntry(`${baseUrl}/cars`, "hourly", 0.95),
    urlEntry(`${baseUrl}/cars/encyclopedia`, "daily", 0.9),
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
