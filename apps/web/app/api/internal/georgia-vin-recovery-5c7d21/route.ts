import { NextResponse } from "next/server";
import { collectGeorgiaYandexRecoverySnapshotWithVinPower } from "../../../../lib/catalog/georgia-vpic-power-recovery";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const pages = Number(url.searchParams.get("pages") || 2);
  const startPage = Number(url.searchParams.get("startPage") || 1);
  const sourceValue = url.searchParams.get("source");
  const source = sourceValue === "myauto" || sourceValue === "autopapa" ? sourceValue : "autopapa";
  const snapshot = await collectGeorgiaYandexRecoverySnapshotWithVinPower(pages, startPage, source);
  return NextResponse.json(snapshot, { headers: { "cache-control": "no-store" } });
}
