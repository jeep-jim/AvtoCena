import { NextResponse } from "next/server";
import { applyEncyclopediaDisplayIdentityBatch } from "@/lib/catalog/display-identity";
import { readHomeCatalogSnapshot } from "@/lib/catalog/storage";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const result = await readHomeCatalogSnapshot(6);
    const items = await applyEncyclopediaDisplayIdentityBatch((result.items || []) as any[]);
    return NextResponse.json({ ...result, items }, {
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    console.error("catalog_home_api_failed", error);
    return NextResponse.json({ error: "catalog_home_failed", items: [], marketCounts: {}, total: 0 }, { status: 500 });
  }
}
