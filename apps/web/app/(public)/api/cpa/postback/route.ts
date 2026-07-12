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
  const expected = process.env.CPA_POSTBACK_SECRET?.trim();

  if (!expected) {
    return NextResponse.json(
      { ok: false, error: "postback_not_configured" },
      { status: 503 },
    );
  }

  if (secret !== expected) {
    return NextResponse.json({ ok: false, error: "wrong_secret" }, { status: 401 });
  }

  const event = appendChunkedDataJson("cpa/events.json", {
    id: makeId("cpa"),
    createdAt: new Date().toISOString(),
    direction: "inbound",
    eventType: "network_postback_received",
    deliveryStatus: "received",
    clickId: url.searchParams.get("click_id"),
    partnerId: url.searchParams.get("partner_id"),
    subid: url.searchParams.get("subid"),
    status: url.searchParams.get("status") || "lead",
    amountRub: Number(url.searchParams.get("amount_rub") || 0) || null
  });

  return NextResponse.json({ ok: true, event });
}
