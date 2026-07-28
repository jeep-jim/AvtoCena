import { NextResponse } from "next/server";
import { readDataJson } from "@/lib/data";
import { PUBLIC_CATALOG_MARKETS } from "@/lib/catalog/runtime-config";

type CatalogManifest = {
  generationId?: string;
  updatedAt?: string;
  markets?: Record<string, { count?: number }>;
};

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const manifest = await readDataJson<CatalogManifest>("catalog/manifest.json", {
    generationId: "empty",
    updatedAt: "",
    markets: {},
  });

  const markets = Object.fromEntries(PUBLIC_CATALOG_MARKETS.map((market) => [
    market,
    Math.max(0, Number(manifest.markets?.[market]?.count || 0)),
  ]));

  return NextResponse.json({
    ok: true,
    generationId: manifest.generationId || "empty",
    updatedAt: manifest.updatedAt || null,
    markets,
    total: Object.values(markets).reduce((sum, count) => sum + count, 0),
  });
}
