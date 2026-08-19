import { ensureAiProductFeed, AI_PRODUCT_FEED_PATH, readAiCatalogProjection } from "@/lib/ai-discovery";
import { getJsonStorage } from "@/lib/data";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const projection = await readAiCatalogProjection();
  const metadata = await ensureAiProductFeed(projection);
  const storage = getJsonStorage();
  const headers = {
    "cache-control": "private, no-store",
    "x-avtocena-catalog-generation": metadata.generationId || "unknown",
    "x-avtocena-product-count": String(metadata.productCount),
    "x-avtocena-feed-format": metadata.format,
  };

  const downloadUrl = await storage.createBinaryDownloadUrl?.(AI_PRODUCT_FEED_PATH, 900);
  if (downloadUrl) {
    return new Response(null, {
      status: 307,
      headers: {
        ...headers,
        location: downloadUrl,
      },
    });
  }

  if (!storage.getBinary) throw new Error("ai_product_feed_binary_storage_unavailable");
  const binary = await storage.getBinary(AI_PRODUCT_FEED_PATH);
  return new Response(binary.data, {
    status: 200,
    headers: {
      ...headers,
      "content-type": binary.mimeType || "application/gzip",
      "content-disposition": 'attachment; filename="avtocena-openai-products.csv.gz"',
      "content-length": String(binary.size),
    },
  });
}
