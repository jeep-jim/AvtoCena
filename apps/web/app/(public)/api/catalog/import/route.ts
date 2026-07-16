import { NextResponse } from "next/server";
import { catalogImportSources, importCatalog } from "@/lib/catalog/importer";
import {
  alternateMarketSources,
  PRODUCTION_CATALOG_SOURCE_IDS,
} from "@/lib/catalog/alternate-market-sources";

for (const source of alternateMarketSources) {
  if (!catalogImportSources.some((candidate) => candidate.sourceId === source.sourceId)) {
    catalogImportSources.push(source);
  }
}

export async function POST(request: Request) {
  const token = request.headers.get("x-admin-token");
  if (!process.env.CATALOG_ADMIN_TOKEN || token !== process.env.CATALOG_ADMIN_TOKEN) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const sources = Array.isArray(body.sources) && body.sources.length ? body.sources : PRODUCTION_CATALOG_SOURCE_IDS;
  return NextResponse.json({ ok: true, report: await importCatalog(sources) });
}
