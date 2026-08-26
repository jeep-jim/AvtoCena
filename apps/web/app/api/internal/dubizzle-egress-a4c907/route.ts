import { NextResponse } from "next/server";
import { DubizzleUaeExactAdapter } from "../../../../lib/catalog/dubizzle-exact-source";
import type { VehicleOffer } from "../../../../lib/catalog/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const source = new DubizzleUaeExactAdapter();

function boundedPage(value: unknown) {
  const page = Math.floor(Number(value));
  return Number.isFinite(page) ? Math.max(1, Math.min(10_000, page)) : 1;
}

function prepare(raw: unknown) {
  const offer = source.normalizeOffer(raw);
  if (!offer) return null;
  const images = Array.isArray((offer.operational?.raw as { images?: unknown[] } | undefined)?.images)
    ? ((offer.operational?.raw as { images: unknown[] }).images
      .map((value) => String(value || "").trim())
      .filter((value) => /^https:\/\//i.test(value)))
    : [];
  if (images.length < 5) return null;
  offer.images = images.slice(0, 30).map((url) => ({
    id: "",
    url,
    objectKey: "",
    checksum: "",
    size: 0,
    mimeType: /\.png(?:[?#]|$)/i.test(url) ? "image/png"
      : /\.webp(?:[?#]|$)/i.test(url) ? "image/webp"
        : /\.avif(?:[?#]|$)/i.test(url) ? "image/avif"
          : "image/jpeg",
  }));
  offer.status = "active";
  return offer as VehicleOffer;
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const page = boundedPage(requestUrl.searchParams.get("page"));
  const startedAt = Date.now();
  try {
    const result = await source.fetchPage(String(page));
    const offers = (result.items || [])
      .map(prepare)
      .filter((offer): offer is VehicleOffer => Boolean(offer));
    return NextResponse.json({
      mode: "yandex_fixed_dubizzle_source_bridge",
      sourceId: "dubizzle_uae_open",
      market: "uae",
      page,
      count: offers.length,
      upstreamCount: Array.isArray(result.items) ? result.items.length : 0,
      nextCursor: result.finished ? null : String(page + 1),
      finished: Boolean(result.finished),
      offers,
      durationMs: Date.now() - startedAt,
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const cause = (error as { cause?: { code?: unknown } })?.cause;
    return NextResponse.json({
      mode: "yandex_fixed_dubizzle_source_bridge",
      sourceId: "dubizzle_uae_open",
      market: "uae",
      page,
      count: 0,
      offers: [],
      error: String((error as Error)?.message || error).slice(0, 300),
      causeCode: String(cause?.code || ""),
      durationMs: Date.now() - startedAt,
    }, { status: 502, headers: { "cache-control": "no-store" } });
  }
}
