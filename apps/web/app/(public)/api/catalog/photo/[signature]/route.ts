import { photoProxyEligible, validPhotoSignature, supportedPhotoContentType } from "@/lib/catalog/photo-proxy-policy";
import { PhotoMemoryCache } from "@/lib/catalog/photo-memory-cache";
import sharp from "sharp";
import crypto from "node:crypto";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const cache = new PhotoMemoryCache();
const timer = setInterval(() => cache.prune(), 60_000); timer.unref?.();
export async function GET(request: Request, {params: routeParams}: {params: Promise<{signature: string}>}) {
  const params = new URL(request.url).searchParams;
  const url = params.get("url") || "", market = params.get("market") || "", sig = (await routeParams).signature;
  if (url.length > 2048 || !photoProxyEligible(url, market) || !validPhotoSignature(url, market, sig)) return new Response(null, {status: 403});
  try {
    const image = await cache.read(url, async () => {
      const response = await fetch(url, {redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10_000), headers: {Accept: "image/webp,image/jpeg,image/png"}});
      if (response.status === 403 || response.status === 429) { await response.body?.cancel(); throw new Error("photo_blocked"); }
      if (!response.ok || !supportedPhotoContentType(response.headers.get("content-type") || "") || Number(response.headers.get("content-length")) > 8 * 1024 * 1024) { await response.body?.cancel(); throw new Error("photo_invalid"); }
      const reader = response.body?.getReader(); if (!reader) throw new Error("photo_empty");
      const chunks: Buffer[] = []; let total = 0;
      try { while (true) { const {done, value} = await reader.read(); if (done) break; total += value.length; if (total > 8 * 1024 * 1024) throw new Error("photo_size"); chunks.push(Buffer.from(value)); } } finally { await reader.cancel().catch(()=>{}); }
      const data = await sharp(Buffer.concat(chunks), {limitInputPixels: 32_000_000}).rotate().resize({width: 1800, height: 1800, fit: "inside", withoutEnlargement: true}).webp({quality: 82}).toBuffer();
      return {data, type: "image/webp"};
    });
    const etag = `"${crypto.createHash("sha256").update(image.data).digest("hex")}"`;
    const headers = {"content-type": image.type, "cache-control": "public, max-age=86400", etag, "x-content-type-options": "nosniff"};
    if (request.headers.get("if-none-match") === etag) return new Response(null, {status: 304, headers});
    return new Response(new Uint8Array(image.data), {headers});
  } catch (error) {
    const reason = error instanceof Error && /^photo_(busy|blocked|invalid|empty|size)$/.test(error.message) ? error.message : "photo_fetch_failed";
    // Never redirect/fall back to the source on overload: that would defeat the limit.
    return new Response(null, {status: 503, headers: {"cache-control": "no-store", "retry-after": "15", "x-photo-status": reason}});
  }
}
