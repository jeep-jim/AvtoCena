import { NextResponse } from "next/server";
import { guaziChinaExactSource } from "../../../../lib/catalog/china-exact-sources";
import type { VehicleOffer } from "../../../../lib/catalog/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function boundedPage(value: unknown) {
  const page = Math.floor(Number(value));
  return Number.isFinite(page) ? Math.max(1, Math.min(10_000, page)) : 1;
}

async function prepare(raw: unknown) {
  const offer = guaziChinaExactSource.normalizeOffer(raw);
  if (!offer) return null;
  try {
    const images = await guaziChinaExactSource.fetchImages(offer);
    if (!images.length) return null;
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
    const result = await guaziChinaExactSource.fetchPage(String(page));
    const prepared = await pool(result.items || [], 4, prepare);
    const offers = prepared.filter((offer): offer is VehicleOffer => Boolean(offer));
    return NextResponse.json({
      mode: "yandex_fixed_guazi_source_bridge",
      sourceId: "guazi_china_open",
      market: "china",
      page,
      count: offers.length,
      upstreamCount: Array.isArray(result.items) ? result.items.length : 0,
      nextCursor: result.nextCursor || String(page + 1),
      finished: Boolean(result.finished),
      upstreamHealth: result.health || null,
      offers,
      durationMs: Date.now() - startedAt,
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const sourceError = error as Error & { blocked?: boolean };
    const message = String(sourceError?.message || error).slice(0, 300);
    const blocked = sourceError.blocked === true || /guazi_source_blocked_bot_challenge/i.test(message);
    return NextResponse.json({
      mode: "yandex_fixed_guazi_source_bridge",
      sourceId: "guazi_china_open",
      market: "china",
      page,
      count: 0,
      offers: [],
      error: message,
      causeCode: blocked ? "guazi_source_blocked_bot_challenge" : "guazi_source_fetch_failed",
      blocked,
      durationMs: Date.now() - startedAt,
    }, { status: blocked ? 503 : 502, headers: { "cache-control": "no-store" } });
  }
}
