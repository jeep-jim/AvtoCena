import { catalogOfferUrl, readAiCatalogProjection } from "@/lib/ai-discovery";

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

function parseSitemapId(raw: string) {
  const normalized = raw.replace(/\.xml$/i, "");
  if (!/^\d+$/.test(normalized)) return null;
  const id = Number(normalized);
  return Number.isSafeInteger(id) && id >= 0 ? id : null;
}

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const id = parseSitemapId(params.id);
  if (id === null) return new Response("Not Found", { status: 404 });

  const projection = await readAiCatalogProjection();
  const start = id * CARS_PER_SITEMAP;
  if (start >= projection.items.length && !(id === 0 && projection.items.length === 0)) {
    return new Response("Not Found", { status: 404 });
  }

  const rows = projection.items.slice(start, start + CARS_PER_SITEMAP);
  const entries = rows.map((item) => {
    const lastmod = item.updatedAt ? new Date(item.updatedAt).toISOString() : new Date().toISOString();
    return [
      "  <url>",
      `    <loc>${xmlEscape(catalogOfferUrl(item.id))}</loc>`,
      `    <lastmod>${xmlEscape(lastmod)}</lastmod>`,
      "    <changefreq>hourly</changefreq>",
      "    <priority>0.68</priority>",
      "  </url>",
    ].join("\n");
  }).join("\n");

  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    entries,
    "</urlset>",
    "",
  ].join("\n");

  return new Response(xml, {
    status: 200,
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "cache-control": "public, max-age=300, s-maxage=300, stale-while-revalidate=3600",
      "x-avtocena-catalog-generation": projection.generationId || "unknown",
      "x-avtocena-sitemap-id": String(id),
      "x-avtocena-sitemap-url-count": String(rows.length),
    },
  });
}
