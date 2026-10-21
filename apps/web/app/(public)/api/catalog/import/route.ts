import { NextResponse } from "next/server";
import { catalogImportSources, importCatalog } from "@/lib/catalog/importer";
import {
  alternateMarketSources,
  PRODUCTION_CATALOG_SOURCE_IDS,
} from "@/lib/catalog/alternate-market-sources";
import {
  publicFallbackSources,
  PUBLIC_FALLBACK_SOURCE_IDS,
} from "@/lib/catalog/public-fallback-sources";

for (const source of [...alternateMarketSources, ...publicFallbackSources]) {
  if (!catalogImportSources.some((candidate) => candidate.sourceId === source.sourceId)) {
    catalogImportSources.push(source);
  }
}

const defaultSourceIds = [...new Set([...PRODUCTION_CATALOG_SOURCE_IDS, ...PUBLIC_FALLBACK_SOURCE_IDS])];

export async function POST(request: Request) {
  const token = request.headers.get("x-admin-token");
  if (!process.env.CATALOG_ADMIN_TOKEN || token !== process.env.CATALOG_ADMIN_TOKEN) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const sources = Array.isArray(body.sources) && body.sources.length ? body.sources : defaultSourceIds;
  return NextResponse.json({ ok: true, report: await importCatalog(sources) });
}
