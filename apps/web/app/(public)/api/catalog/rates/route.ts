import { NextResponse } from "next/server";
import { loadPublicRateExtras } from "@/lib/catalog/public-rates";

export const dynamic = "force-dynamic";

export async function GET() {
  const extras = await loadPublicRateExtras();
  return NextResponse.json({ ok: true, ...extras }, {
    headers: { "Cache-Control": "public, max-age=900, s-maxage=900" },
  });
}
