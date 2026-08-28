import { NextResponse } from "next/server";
import { GoonetExactAdapter } from "../../../../lib/catalog/goonet-exact-source";
import type { VehicleOffer } from "../../../../lib/catalog/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const source = new GoonetExactAdapter();

function boundedPage(value: unknown) {
  const page = Math.floor(Number(value));
  return Number.isFinite(page) ? Math.max(1, Math.min(10_000, page)) : 1;
}

async function pool<T, R>(rows: T[], limit: number, worker: (row: T) => Promise<R>) {
  const output = new Array<R>(rows.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, rows.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= rows.length) return;
      output[index] = await worker(rows[index]);
    }
  }));
  return output;
}

async function prepare(raw: unknown) {
  const offer = source.normalizeOffer(raw);
  if (!offer) return null;
  try {
    const images = await source.fetchImages(offer);
    if (images.length < 2) return null;
    offer.images = images;
    offer.status = "active";
    return offer as VehicleOffer;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const page = boundedPage(requestUrl.searchParams.get("page"));
  const startedAt = Date.now();
  try {
    const result = await source.fetchPage(String(page));
    const prepared = await pool(result.items || [], 8, prepare);
    const offers = prepared.filter((offer): offer is VehicleOffer => Boolean(offer));
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
