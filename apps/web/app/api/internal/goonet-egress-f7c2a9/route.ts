import { NextResponse } from "next/server";
import { coherentGoonetImages, GoonetExactAdapter } from "../../../../lib/catalog/goonet-exact-source";
import type { VehicleOffer } from "../../../../lib/catalog/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const source = new GoonetExactAdapter();

function boundedPage(value: unknown) {
  const page = Math.floor(Number(value));
  return Number.isFinite(page) ? Math.max(1, Math.min(10_000, page)) : 1;
}

function sourceUrlImage(url: string) {
  return {
    id: "",
    url,
    objectKey: "",
    checksum: "",
    size: 0,
    mimeType: /\.png(?:[?#]|$)/i.test(url) ? "image/png"
      : /\.webp(?:[?#]|$)/i.test(url) ? "image/webp"
        : "image/jpeg",
  };
}

function prepare(raw: unknown) {
  const offer = source.normalizeOffer(raw);
  if (!offer) return null;
  const row = (offer.operational?.raw || {}) as { url?: string; images?: string[] };
  const sourceUrl = String(row.url || offer.operational?.sourceUrl || "");
  const urls = coherentGoonetImages(Array.isArray(row.images) ? row.images : [], 30, sourceUrl);
  if (urls.length < 2) return null;

  offer.images = urls.map(sourceUrlImage);
  offer.status = "active";
  const operational = offer.operational as Record<string, any>;
  operational.photoIdentityVerified = true;
  operational.galleryVerified = true;
  operational.galleryImageCount = offer.images.length;
  operational.gallerySafetyMode = "goonet_exact_page_bound_j_source_urls_v3";
  operational.galleryStoredAs = "json_urls";
  operational.raw = {
    ...row,
    photoIdentityVerified: true,
    listingBoundImages: true,
    detailIdentityVerified: true,
    primaryListingFrameVerified: true,
  };
  return offer as VehicleOffer;
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const page = boundedPage(requestUrl.searchParams.get("page"));
  const startedAt = Date.now();
  try {
    const result = await source.fetchPage(String(page));
    const offers = (result.items || []).map(prepare).filter((offer): offer is VehicleOffer => Boolean(offer));
    return NextResponse.json({
      mode: "yandex_fixed_goonet_source_bridge",
      sourceId: "goonet_japan_exact",
      market: "japan",
      page,
      count: offers.length,
      upstreamCount: Array.isArray(result.items) ? result.items.length : 0,
      nextCursor: result.nextCursor || String(page + 1),
      finished: Boolean(result.finished),
      offers,
      durationMs: Date.now() - startedAt,
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return NextResponse.json({
      mode: "yandex_fixed_goonet_source_bridge",
      sourceId: "goonet_japan_exact",
      market: "japan",
      page,
      count: 0,
      offers: [],
      error: String((error as Error)?.message || error).slice(0, 300),
      durationMs: Date.now() - startedAt,
    }, { status: 502, headers: { "cache-control": "no-store" } });
  }
}
