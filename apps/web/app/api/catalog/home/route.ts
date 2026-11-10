import {readGreenCorner} from '@/lib/catalog/green-corner';
import {withAjesCount} from '@/lib/catalog/ajes-catalog';
import { NextResponse } from "next/server";
import { applyActiveBusinessPricingBatch } from "@/lib/catalog/live-business-pricing";
import { readHomeCatalogSnapshot } from "@/lib/catalog/storage";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const started = performance.now();
  try {
    const result = await readHomeCatalogSnapshot(10);
    const readMs = performance.now() - started;
    const [combined,green] = await Promise.all([withAjesCount(result),readGreenCorner().catch(()=>null)]);
    const items = await applyActiveBusinessPricingBatch(combined.items);
    const pricingMs = performance.now() - started - readMs;
    return NextResponse.json({ ...combined, total:combined.total+(green?.items.length||0),countIncomplete:combined.countIncomplete||!green, items }, {
      headers: { "Cache-Control": "no-store, max-age=0", "Server-Timing": `catalog-read;dur=${readMs.toFixed(1)}, catalog-pricing;dur=${pricingMs.toFixed(1)}` },
    });
  } catch (error) {
    console.error("catalog_home_api_failed", error);
    return NextResponse.json({ error: "catalog_home_failed", items: [], marketCounts: {}, total: null, countIncomplete: true }, { status: 503 });
  }
}
