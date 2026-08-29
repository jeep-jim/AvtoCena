import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(
    { error: "catalog_source_not_approved" },
    { status: 410, headers: { "cache-control": "no-store" } },
  );
}
