import { NextResponse } from "next/server";
import { searchOffers } from "@/lib/catalog/storage";
function n(v: string | null) { const x = Number(v); return Number.isFinite(x) && x > 0 ? x : undefined; }
export async function GET(request: Request) {
  const u = new URL(request.url); const p = u.searchParams;
  const result = await searchOffers({ market: p.get("market") || undefined, make: p.get("make") || p.get("brand") || undefined, model: p.get("model") || undefined, budgetFrom: n(p.get("budgetFrom")), budgetTo: n(p.get("budgetTo") || p.get("budget")), yearFrom: n(p.get("yearFrom")), yearTo: n(p.get("yearTo")), mileageTo: n(p.get("mileageTo")), fuel: p.get("fuel") || undefined, transmission: p.get("transmission") || undefined, drive: p.get("drive") || undefined, bodyType: p.get("bodyType") || p.get("body") || undefined, auctionGrade: p.get("auctionGrade") || undefined, sort: p.get("sort") || undefined, page: n(p.get("page")), pageSize: n(p.get("pageSize")) });
  return NextResponse.json({ ok: true, ...result });
}
