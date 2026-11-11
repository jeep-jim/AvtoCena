import { readAllModelSeoLinks } from "@/lib/catalog/model-directory";

export const dynamic = "force-dynamic";

// The saved Knowledge CORE now contributes ~20k source-backed models. A single
// 20k+ URL XML response can exceed the Serverless Containers / gateway response
// budget even though reading the identity index itself succeeds. Keep shards
// deliberately small; the sitemap index remains the single discovery endpoint.
const MODELS_PER_SITEMAP = 5_000;

function xmlEscape(value: unknown) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function GET() {
  const rows = await readAllModelSeoLinks().catch((error) => {
    console.error("model_sitemap_index_failed", error);
    return [];
  });
  const count = Math.max(1, Math.ceil(rows.length / MODELS_PER_SITEMAP));
  const lastmod = new Date().toISOString();
  const entries = Array.from({ length: count }, (_, id) => [
    "  <sitemap>",
    `    <loc>${xmlEscape(`https://avtocena.com/cars/models-sitemap/${id}.xml`)}</loc>`,
    `    <lastmod>${lastmod}</lastmod>`,
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
      "cache-control": "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400",
      "x-avtocena-model-count": String(rows.length),
      "x-avtocena-model-sitemap-count": String(count),
    },
  });
}
