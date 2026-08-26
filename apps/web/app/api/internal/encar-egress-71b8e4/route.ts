import { NextResponse } from "next/server";
import { EncarCompleteAdapter } from "../../../../lib/catalog/encar-complete-source";
import type { VehicleOffer } from "../../../../lib/catalog/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PAGE_SIZE = 20;
const source = new EncarCompleteAdapter(PAGE_SIZE);

function boundedPage(value: unknown) {
  const page = Math.floor(Number(value));
  return Number.isFinite(page) ? Math.max(1, Math.min(10_000, page)) : 1;
}

function pageCursor(page: number) {
  return JSON.stringify({ offset: (page - 1) * PAGE_SIZE, cursor: "" });
}

async function prepare(raw: unknown) {
  const offer = source.normalizeOffer(raw);
  if (!offer) return null;
  try {
    const images = await source.fetchImages(offer);
    if (images.length < 5) return null;
    offer.images = images;
    offer.status = "active";
    return offer as VehicleOffer;
  } catch {
    return null;
  }
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

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const page = boundedPage(requestUrl.searchParams.get("page"));
  const startedAt = Date.now();
  try {
    const result = await source.fetchPage(pageCursor(page));
    const prepared = await pool(result.items || [], 4, prepare);
    const offers = prepared.filter((offer): offer is VehicleOffer => Boolean(offer));
    return NextResponse.json({
      mode: "yandex_fixed_encar_source_bridge",
      sourceId: "encar_direct",
      market: "korea",
      page,
      count: offers.length,
      upstreamCount: Array.isArray(result.items) ? result.items.length : 0,
      nextCursor: result.finished ? null : String(page + 1),
      finished: Boolean(result.finished),
      offers,
      durationMs: Date.now() - startedAt,
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const cause = (error as any)?.cause;
    return NextResponse.json({
      mode: "yandex_fixed_encar_source_bridge",
      sourceId: "encar_direct",
      market: "korea",
      page,
      count: 0,
      offers: [],
      error: String((error as Error)?.message || error).slice(0, 300),
      causeCode: String(cause?.code || ""),
      durationMs: Date.now() - startedAt,
    }, { status: 502, headers: { "cache-control": "no-store" } });
  }
}
