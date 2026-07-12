import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { appendChunkedDataJson, readChunkedDataJson, readDataJson } from "@/lib/data";

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

function cleanAttribution(value: unknown) {
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};

  return {
    clickId: clean(source.clickId, 120),
    externalClickId: clean(source.externalClickId, 255),
    partnerRef: clean(source.partnerRef, 120),
    sub1: clean(source.sub1, 255),
    sub2: clean(source.sub2, 255),
    sub3: clean(source.sub3, 255),
    sub4: clean(source.sub4, 255),
    sub5: clean(source.sub5, 255),
    utmSource: clean(source.utmSource, 255),
    utmMedium: clean(source.utmMedium, 255),
    utmCampaign: clean(source.utmCampaign, 255),
    utmContent: clean(source.utmContent, 255),
    utmTerm: clean(source.utmTerm, 255),
    firstSeenAt: clean(source.firstSeenAt, 64),
    lastSeenAt: clean(source.lastSeenAt, 64),
    firstLandingUrl: clean(source.firstLandingUrl, 1000),
    lastLandingUrl: clean(source.lastLandingUrl, 1000),
    referrer: clean(source.referrer, 1000)
  };
}

export async function GET() {
  const payouts = readDataJson("cpa/payouts.json", { defaultSignedContractPayoutRub: 10000 });

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
      landing: "https://avtocena.com/?ref={partner_id}&click_id={click_id}&sub1={sub1}&sub2={sub2}",
      postback: "https://avtocena.com/api/cpa/postback?secret={secret}&click_id={click_id}&status=signed_contract"
    },
    events: ["visit", "calculation_completed", "lead_created", "contract_signed", "paid"]
  });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const eventType = clean(body.eventType, 80);

  if (eventType !== "visit" && eventType !== "calculation_completed") {
    return NextResponse.json({ ok: false, error: "unsupported_event" }, { status: 400 });
  }

  const attribution = cleanAttribution(body.attribution);
  if (!attribution.clickId) {
    return NextResponse.json({ ok: false, error: "click_id_required" }, { status: 400 });
  }

  const calculationKey = clean(body.calculationKey, 500);
  const dedupeKey = [eventType, attribution.clickId, calculationKey].join(":");
  const events = readChunkedDataJson<any>("cpa/events.json", []);
  const existing = events.find((event) => event.dedupeKey === dedupeKey);

  if (existing) {
    return NextResponse.json({ ok: true, duplicate: true, eventId: existing.id });
  }

  const createdAt = new Date().toISOString();
  const event = appendChunkedDataJson("cpa/events.json", {
    id: makeId("cpa"),
    createdAt,
    eventType,
    dedupeKey,
    clickId: attribution.clickId,
    externalClickId: attribution.externalClickId,
    partnerRef: attribution.partnerRef,
    sub1: attribution.sub1,
    sub2: attribution.sub2,
    sub3: attribution.sub3,
    sub4: attribution.sub4,
    sub5: attribution.sub5,
    utmSource: attribution.utmSource,
    utmMedium: attribution.utmMedium,
    utmCampaign: attribution.utmCampaign,
    utmContent: attribution.utmContent,
    utmTerm: attribution.utmTerm,
    pageUrl: clean(body.pageUrl, 1000),
    landingPath: clean(body.landingPath, 500),
    calculationKey,
    search: body.search && typeof body.search === "object" ? body.search : null
  });

  return NextResponse.json({ ok: true, eventId: event.id });
}
