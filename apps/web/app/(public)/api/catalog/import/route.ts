import { NextResponse } from "next/server";
import { importCatalog } from "@/lib/catalog/importer";
export async function POST(request: Request) { const token = request.headers.get("x-admin-token") || new URL(request.url).searchParams.get("token"); if (!process.env.CATALOG_ADMIN_TOKEN || token !== process.env.CATALOG_ADMIN_TOKEN) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 }); const body = await request.json().catch(() => ({})); return NextResponse.json({ ok: true, report: await importCatalog(Array.isArray(body.sources) ? body.sources : undefined) }); }
