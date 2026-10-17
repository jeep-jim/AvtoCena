import { NextResponse } from "next/server";
import { readPublicCatalogMarketCounts } from "@/lib/catalog/storage";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const snapshot = await readPublicCatalogMarketCounts();

  return NextResponse.json({
    ok: true,
    ...snapshot,
  });
}
