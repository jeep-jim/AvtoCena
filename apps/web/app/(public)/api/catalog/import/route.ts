import { NextResponse } from "next/server";
import { importCatalog } from "@/lib/catalog/importer";
import { PUBLIC_CATALOG_SOURCE_IDS } from "@/lib/catalog/public-market-sources";

export async function POST(request: Request) {
  const token = request.headers.get("x-admin-token");
  if (!process.env.CATALOG_ADMIN_TOKEN || token !== process.env.CATALOG_ADMIN_TOKEN) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const sources = Array.isArray(body.sources) && body.sources.length ? body.sources : PUBLIC_CATALOG_SOURCE_IDS;
  return NextResponse.json({ ok: true, report: await importCatalog(sources) });
}
