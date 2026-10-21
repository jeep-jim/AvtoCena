import { readAutocatalogPublishedCovers } from "@/lib/catalog/autocatalog-publication";
import { getJsonStorage } from "@/lib/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ checksum: string }> }) {
  const { checksum } = await params;
  if (!/^[a-f0-9]{64}$/.test(checksum)) return new Response("Not found", { status: 404 });
  const covers = await readAutocatalogPublishedCovers();
  const cover = covers.find((row) => row.sha256 === checksum);
  if (!cover || !cover.objectKey.endsWith(`/${checksum}.webp`)) return new Response("Not found", { status: 404 });
  const storage = getJsonStorage();
  if (!storage.getBinary) return new Response("Not found", { status: 404 });
  try {
    const file = await storage.getBinary(cover.objectKey);
    const body = new Uint8Array(file.data.byteLength);
    body.set(file.data);
    return new Response(body, {
      headers: {
        "content-type": "image/webp",
        "cache-control": "public, max-age=86400, stale-while-revalidate=604800",
        etag: `"${file.checksum}"`,
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
