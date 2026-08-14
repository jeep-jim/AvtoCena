import { gzipSync } from "node:zlib";
import { aiCatalogDescription, aiCatalogTitle, absoluteAvtocenaUrl, catalogOfferUrl, readAiCatalogProjection } from "@/lib/ai-discovery";

export const dynamic = "force-dynamic";
export const revalidate = 300;

const HEADER = [
  "id",
  "title",
  "description",
  "link",
  "image_link",
  "availability",
  "price",
  "brand",
  "identifier_exists",
  "product_type",
];

function csvCell(value: unknown) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

export async function GET() {
  const projection = await readAiCatalogProjection();
  const rows = projection.items
    .filter((item) => Number(item.totalRub || item.publicVisibleRub || 0) > 0 && Boolean(item.cardImageUrl))
    .map((item) => {
      const priceRub = Math.round(Number(item.totalRub || item.publicVisibleRub || 0));
      const values = [
        item.id,
        aiCatalogTitle(item).slice(0, 150),
        aiCatalogDescription(item).slice(0, 5000),
        catalogOfferUrl(item.id),
        absoluteAvtocenaUrl(item.cardImageUrl),
        "in_stock",
        `${priceRub} RUB`,
        item.make,
        "no",
        "Vehicles > Cars",
      ];
      return values.map(csvCell).join(",");
    });

  const body = `\uFEFF${HEADER.join(",")}\n${rows.join("\n")}\n`;
  const compressed = gzipSync(Buffer.from(body, "utf8"), { level: 6 });

  return new Response(compressed, {
    status: 200,
    headers: {
      "content-type": "application/gzip",
      "content-disposition": 'attachment; filename="avtocena-openai-products.csv.gz"',
      "cache-control": "public, max-age=300, s-maxage=300, stale-while-revalidate=600",
      "x-avtocena-catalog-generation": projection.generationId || "unknown",
      "x-avtocena-product-count": String(rows.length),
      "x-avtocena-feed-format": "google-compatible-csv-gzip",
    },
  });
}
