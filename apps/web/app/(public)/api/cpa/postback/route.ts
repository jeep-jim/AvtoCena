import { NextResponse } from "next/server";
import { appendDataJson } from "@/lib/data";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const secret = url.searchParams.get("secret");
  const expected = process.env.CPA_POSTBACK_SECRET;

  if (expected && secret !== expected) {
    return NextResponse.json({ ok: false, error: "wrong_secret" }, { status: 401 });
  }

  const event = appendDataJson("cpa/events.json", {
    id: `cpa_${Date.now()}`,
    createdAt: new Date().toISOString(),
    clickId: url.searchParams.get("click_id"),
    partnerId: url.searchParams.get("partner_id"),
    subid: url.searchParams.get("subid"),
    status: url.searchParams.get("status") || "lead",
    amountRub: Number(url.searchParams.get("amount_rub") || 0) || null
  });

  return NextResponse.json({ ok: true, event });
}
