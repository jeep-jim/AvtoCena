import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { appendChunkedDataJson } from "@/lib/data";

function makeId(prefix: string) {
  try {
    return `${prefix}_${crypto.randomUUID()}`;
  } catch {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const secret = url.searchParams.get("secret");
  const expected = process.env.CPA_POSTBACK_SECRET;

  if (expected && secret !== expected) {
    return NextResponse.json({ ok: false, error: "wrong_secret" }, { status: 401 });
  }

  const status = url.searchParams.get("status") || "lead";
  const event = appendChunkedDataJson("cpa/events.json", {
    id: makeId("cpa"),
    createdAt: new Date().toISOString(),
    eventType: "external_postback",
    clickId: url.searchParams.get("internal_click_id") || "",
    externalClickId: url.searchParams.get("click_id") || "",
    partnerId: url.searchParams.get("partner_id") || "",
    partnerRef: url.searchParams.get("partner_ref") || url.searchParams.get("partner_id") || "",
    sub1: url.searchParams.get("sub1") || url.searchParams.get("subid") || "",
    sub2: url.searchParams.get("sub2") || "",
    sub3: url.searchParams.get("sub3") || "",
    sub4: url.searchParams.get("sub4") || "",
    sub5: url.searchParams.get("sub5") || "",
    status,
    amountRub: Number(url.searchParams.get("amount_rub") || 0) || null
  });

  return NextResponse.json({ ok: true, event });
}
