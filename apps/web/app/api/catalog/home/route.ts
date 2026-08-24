import { NextResponse } from "next/server";
import { applyEncyclopediaDisplayIdentityBatch } from "@/lib/catalog/display-identity";
import { readHomeCatalogSnapshot, searchOffers } from "@/lib/catalog/storage";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const result = await readHomeCatalogSnapshot(6);
    let rows = [...(result.items || [])] as any[];
    const missingMarkets = Object.entries(result.marketCounts || {})
      .filter(([market, count]) => Number(count || 0) > 0 && !rows.some((row) => String(row?.market || "") === market))
      .map(([market]) => market);
    if (missingMarkets.length) {
      const recovered = await Promise.all(missingMarkets.map(async (market) => {
        try {
          const result = await searchOffers({ market: market as any, page: 1, pageSize: 6, sort: "updatedAt" });
          return result.items || [];
        } catch (error) {
          console.error("catalog_home_market_recovery_failed", market, error);
          return [];
        }
      }));
      const seen = new Set(rows.map((row) => String(row?.id || "")));
      for (const row of recovered.flat()) {
        const id = String((row as any)?.id || "");
        if (!id || seen.has(id)) continue;
        seen.add(id);
        rows.push(row as any);
      }
    }
    const items = await applyEncyclopediaDisplayIdentityBatch(rows);
    return NextResponse.json({ ...result, items }, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    console.error("catalog_home_api_failed", error);
    return NextResponse.json({ error: "catalog_home_failed", items: [], marketCounts: {}, total: 0 }, { status: 500 });
  }
}
