import crypto from "node:crypto";
import { NextResponse } from "next/server";
import {
  appendChunkedDataJson,
  readChunkedDataJson,
  readDataJson
} from "@/lib/data";

const PUBLIC_EVENT_TYPES = new Set(["visit", "calculation_completed"]);

function clean(value: unknown, maxLength = 500) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function makeId(prefix: string) {
  try {
    return `${prefix}_${crypto.randomUUID()}`;
  } catch {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }
}

function normalizeAttribution(value: unknown) {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};

  return {
    clickId: clean(source.clickId, 160),
    externalClickId: clean(source.externalClickId, 300),
    partnerRef: clean(source.partnerRef, 160),
    sub1: clean(source.sub1),
    sub2: clean(source.sub2),
    sub3: clean(source.sub3),
    sub4: clean(source.sub4),
    sub5: clean(source.sub5),
    utmSource: clean(source.utmSource),
    utmMedium: clean(source.utmMedium),
    utmCampaign: clean(source.utmCampaign),
    utmContent: clean(source.utmContent),
    utmTerm: clean(source.utmTerm),
    firstSeenAt: clean(source.firstSeenAt, 80),
    lastSeenAt: clean(source.lastSeenAt, 80),
    firstLandingUrl: clean(source.firstLandingUrl, 1500),
    lastLandingUrl: clean(source.lastLandingUrl, 1500),
    referrer: clean(source.referrer, 1500)
  };
}

export async function GET() {
  const payouts = readDataJson("cpa/payouts.json", {
    defaultSignedContractPayoutRub: 10000
  });

  return NextResponse.json({
    name: "AvtoCena CPA API",
    version: "0.2",
    offer: {
      title: "АвтоЦена — заявка на авто под заказ",
      goal: "signed_contract",
      payoutRub: payouts.defaultSignedContractPayoutRub,
      holdDays: 0
    },
    tracking: {
      landing: "https://avtocena.com/?ref={partner_id}&click_id={click_id}&sub1={sub1}",
      browserEvents: "POST https://avtocena.com/api/cpa",
      statusSource: "CRM manager actions",
      outboundPostback: "configured per CPA network adapter"
    },
    events: [
      "visit",
      "calculation_completed",
      "lead_created",
      "lead_status_changed",
      "contract_signed"
    ]
  });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const eventType = clean(body.eventType, 80);

  if (!PUBLIC_EVENT_TYPES.has(eventType)) {
    return NextResponse.json(
      { ok: false, error: "unsupported_event_type" },
      { status: 400 }
    );
  }

  const attribution = normalizeAttribution(body.attribution);

  if (!attribution.clickId) {
    return NextResponse.json(
      { ok: false, error: "click_id_required" },
      { status: 400 }
    );
  }

  const calculationKey = clean(body.calculationKey, 300);
  const dedupeKey = [eventType, attribution.clickId, calculationKey].join(":");
  const existing = readChunkedDataJson<any>("cpa/events.json", []).find(
    (event) => event.dedupeKey === dedupeKey
  );

  if (existing) {
    return NextResponse.json({ ok: true, event: existing, duplicate: true });
  }

  const event = appendChunkedDataJson("cpa/events.json", {
    id: makeId("cpa"),
    createdAt: new Date().toISOString(),
    direction: "inbound",
    eventType,
    status: "tracked",
    deliveryStatus: "not_required",
    dedupeKey,
    ...attribution,
    pageUrl: clean(body.pageUrl, 1500),
    landingPath: clean(body.landingPath, 1000),
    calculationKey
  });

  return NextResponse.json({ ok: true, event });
}
