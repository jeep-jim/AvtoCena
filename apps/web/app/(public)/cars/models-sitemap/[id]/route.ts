import { readAllModelSeoLinks } from "@/lib/catalog/model-directory";

export const dynamic = "force-dynamic";

const MODELS_PER_SITEMAP = 5_000;

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

function safeIso(value: unknown) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : new Date().toISOString();
}

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const id = parseSitemapId(params.id);
  if (id === null) return new Response("Not Found", { status: 404 });

  const all = await readAllModelSeoLinks().catch((error) => {
    console.error("model_sitemap_shard_failed", error);
    return [];
  });
  const start = id * MODELS_PER_SITEMAP;
  if (start >= all.length && !(id === 0 && all.length === 0)) return new Response("Not Found", { status: 404 });
  const rows = all.slice(start, start + MODELS_PER_SITEMAP);
  const entries = rows.map((model) => [
    "  <url>",
    `    <loc>${xmlEscape(`https://avtocena.com/cars/brand/${model.brandSlug}/model/${model.modelSlug}`)}</loc>`,
    `    <lastmod>${safeIso(model.updatedAt)}</lastmod>`,
    "    <changefreq>daily</changefreq>",
    "    <priority>0.72</priority>",
    "  </url>",
  ].join("\n")).join("\n");

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
      "cache-control": "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400",
      "x-avtocena-model-sitemap-id": String(id),
      "x-avtocena-model-url-count": String(rows.length),
    },
  });
}
