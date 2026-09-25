import { NextResponse } from "next/server";
import { collectGeorgiaYandexRecoverySnapshot } from "../../../../lib/catalog/georgia-yandex-recovery";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const pages = Number(url.searchParams.get("pages") || 2);
  const startPage = Number(url.searchParams.get("startPage") || 1);
  const sourceValue = url.searchParams.get("source");
  const source = sourceValue === "myauto" || sourceValue === "autopapa" ? sourceValue : "all";
  try {
    const snapshot = await collectGeorgiaYandexRecoverySnapshot(pages, startPage, source);
    return NextResponse.json(snapshot, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    // Preserve source refusal metadata. An HTML 500 response used to hide it
    // from the collector, which mistook the refusal for a transient outage.
    const failure = error as Error & { blocked?: boolean };
    const blocked = failure?.blocked === true;
    return NextResponse.json({
      market: "georgia", source, count: 0, offers: [], blocked,
      error: String(failure?.message || error).slice(0, 300),
      causeCode: blocked ? "georgia_source_access_refused" : "georgia_source_fetch_failed",
    }, { status: blocked ? 503 : 502, headers: { "cache-control": "no-store" } });
  }
}
