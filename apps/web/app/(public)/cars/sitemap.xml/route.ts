import { aiCatalogManifestCount, readAiCatalogManifest } from "@/lib/ai-discovery";

export const dynamic = "force-dynamic";

const CARS_PER_SITEMAP = 45_000;

function xmlEscape(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function GET() {
  const manifest = await readAiCatalogManifest();
  const total = aiCatalogManifestCount(manifest);
  const count = Math.max(1, Math.ceil(total / CARS_PER_SITEMAP));
  const lastmod = manifest.updatedAt ? new Date(manifest.updatedAt).toISOString() : new Date().toISOString();
  const entries = Array.from({ length: count }, (_, id) => [
    "  <sitemap>",
    `    <loc>${xmlEscape(`https://avtocena.com/cars/sitemap/${id}.xml`)}</loc>`,
    `    <lastmod>${xmlEscape(lastmod)}</lastmod>`,
    "  </sitemap>",
  ].join("\n")).join("\n");

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    entries,
    "</sitemapindex>",
    "",
  ].join("\n");

  return new Response(xml, {
    status: 200,
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "cache-control": "public, max-age=300, s-maxage=300, stale-while-revalidate=3600",
      "x-avtocena-catalog-count": String(total),
      "x-avtocena-sitemap-count": String(count),
    },
  });
}
