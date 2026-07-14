import { NextResponse } from "next/server";
import { readCatalogImage } from "@/lib/catalog/storage";
export async function GET(request: Request, { params }: { params: { imageId: string } }) {
  const image = await readCatalogImage(params.imageId);
  if (!image) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  const etag = `"${image.checksum}"`;
  if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: { etag } });
  return new Response(new Uint8Array(image.data), { headers: { "content-type": image.mimeType || "application/octet-stream", "cache-control": "public, max-age=31536000, immutable", etag } });
}
