import {sourceBridgeAuthorized} from '../../../../lib/catalog/source-bridge-auth';
import {assertCollectionEnabled} from '../../../../lib/catalog/collection-controls';
import { NextResponse } from "next/server";
import { collectGeorgiaYandexRecoverySnapshotWithVinPower } from "../../../../lib/catalog/georgia-vpic-power-recovery";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  if(!sourceBridgeAuthorized(request))return NextResponse.json({error:"Forbidden"},{status:403,headers:{"cache-control":"no-store"}});
  const url = new URL(request.url);
  const pages = Number(url.searchParams.get("pages") || 2);
  const startPage = Number(url.searchParams.get("startPage") || 1);
  const sourceValue = url.searchParams.get("source");
  const source = sourceValue === "myauto" || sourceValue === "autopapa" ? sourceValue : "autopapa";
  await assertCollectionEnabled(source==='myauto'?'myauto_georgia_list':'autopapa_georgia_open');
  const snapshot = await collectGeorgiaYandexRecoverySnapshotWithVinPower(pages, startPage, source);
  return NextResponse.json(snapshot, { headers: { "cache-control": "no-store" } });
}
