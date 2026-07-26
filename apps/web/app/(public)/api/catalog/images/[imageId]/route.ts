import { NextResponse } from "next/server";
import { getJsonStorage, readDataJson } from "@/lib/data";

type CatalogManifest = {
  generationId: string;
};

type CatalogImageIndex = {
  imagesById: Record<string, {
    objectKey: string;
    mimeType: string;
    checksum: string;
    size: number;
  }>;
};

async function readCatalogImage(imageId: string) {
  const manifest = await readDataJson<CatalogManifest>("catalog/manifest.json", { generationId: "empty" });
  const indexPath = `catalog/generations/${manifest.generationId}/indexes/images-by-id.json`;
  const index = await readDataJson<CatalogImageIndex>(indexPath, { imagesById: {} });
  const meta = index.imagesById[imageId];
  if (!meta) return null;
  const binary = await getJsonStorage().getBinary?.(meta.objectKey);
  return binary
    ? {
      ...binary,
      mimeType: binary.mimeType || meta.mimeType,
      checksum: meta.checksum,
      size: meta.size,
    }
    : null;
}

export async function GET(request: Request, { params }: { params: { imageId: string } }) {
  const image = await readCatalogImage(params.imageId);
  if (!image) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  const etag = `"${image.checksum}"`;
  if (request.headers.get("if-none-match") === etag) return new Response(null, { status: 304, headers: { etag } });
  return new Response(new Uint8Array(image.data), {
    headers: {
      "content-type": image.mimeType || "application/octet-stream",
      "cache-control": "public, max-age=31536000, immutable",
      etag,
    },
  });
}
