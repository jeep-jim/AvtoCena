import crypto from "node:crypto";
import { NextResponse } from "next/server";
import {
  appendChunkedDataJson,
  readChunkedDataJson
} from "@/lib/data";
import { deliverCpaEvent } from "@/lib/cpa-gateway";
import { getBusinessSettingsSnapshot } from "@/lib/business-settings";

function clean(value: unknown, maxLength = 500) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function numberOrNull(value: unknown) {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : null;
}

function makeId(prefix: string) {
  try {
    return `${prefix}_${crypto.randomUUID()}`;
  } catch {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }
}

function normalizeAttribution(value: unknown, body: Record<string, unknown>) {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};

  return {
    clickId: clean(source.clickId || body.internalClickId, 160),
    externalClickId: clean(source.externalClickId || body.clickId, 300),
    partnerRef: clean(source.partnerRef || body.partnerRef, 160),
    sub1: clean(source.sub1 || body.sub1),
    sub2: clean(source.sub2 || body.sub2),
    sub3: clean(source.sub3 || body.sub3),
    sub4: clean(source.sub4 || body.sub4),
    sub5: clean(source.sub5 || body.sub5),
    utmSource: clean(source.utmSource || body.utmSource),
    utmMedium: clean(source.utmMedium || body.utmMedium),
    utmCampaign: clean(source.utmCampaign || body.utmCampaign),
    utmContent: clean(source.utmContent || body.utmContent),
    utmTerm: clean(source.utmTerm || body.utmTerm),
    firstSeenAt: clean(source.firstSeenAt, 80),
    lastSeenAt: clean(source.lastSeenAt, 80),
    firstLandingUrl: clean(source.firstLandingUrl, 1500),
    lastLandingUrl: clean(source.lastLandingUrl, 1500),
    referrer: clean(source.referrer, 1500)
  };
}

export async function GET() {
  const leads = readChunkedDataJson<any>("leads/leads.json", []);
  return NextResponse.json({ ok: true, leads });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;

  const phone = clean(body.phone, 80);
  const telegram = clean(body.telegram, 160);
  const name = clean(body.name, 300);
  const city = clean(body.city, 300);
  const comment = clean(body.comment, 2000);

  if (!phone && !telegram) {
    return NextResponse.json(
      { ok: false, error: "phone_or_telegram_required" },
      { status: 400 }
    );
  }

  const createdAt = new Date().toISOString();
  const clientId = makeId("client");
  const leadId = makeId("lead");
  const attribution = normalizeAttribution(body.attribution, body);
  const source = clean(body.source, 160) || "site";
  const market = clean(body.market, 120);
  const businessSettingsSnapshot = market ? getBusinessSettingsSnapshot(market) : null;
  const calculationSnapshot = body.calculationSnapshot && typeof body.calculationSnapshot === "object" ? body.calculationSnapshot : null;

  const client = appendChunkedDataJson("clients/clients.json", {
    id: clientId,
    createdAt,
    updatedAt: createdAt,
    fio: name,
    phone,
    telegram,
    city,
    comment,
    source,
    partnerRef: attribution.partnerRef,
    attribution,
    createdByManagerId: null,
    assignedManagerId: null,
    configVersion: businessSettingsSnapshot?.configVersion || "",
    effectiveFrom: businessSettingsSnapshot?.effectiveFrom || "",
    businessSettingsSnapshot,
    calculationSnapshot,
    breakdown: calculationSnapshot && typeof calculationSnapshot === "object" && Array.isArray((calculationSnapshot as any).breakdown) ? (calculationSnapshot as any).breakdown : []
  });

  const lead = appendChunkedDataJson("leads/leads.json", {
    id: leadId,
    createdAt,
    updatedAt: createdAt,
    status: "new",
    statusHistory: [
      {
        status: "new",
        changedAt: createdAt,
        changedByUserId: null,
        changedByName: "Сайт",
        note: "Заявка создана"
      }
    ],
    clientId,
    name,
    phone,
    telegram,
    city,
    comment,
    carId: clean(body.carId, 200),
    car: clean(body.car, 500),
    brand: clean(body.brand, 200),
    model: clean(body.model, 200),
    market,
    marketName: clean(body.marketName, 200),
    year: numberOrNull(body.year),
    budgetRub: numberOrNull(body.budgetRub),
    totalRub: numberOrNull(body.totalRub),
    source,
    ...attribution,
    attribution,
    createdByManagerId: null,
    assignedManagerId: null,
    configVersion: businessSettingsSnapshot?.configVersion || "",
    effectiveFrom: businessSettingsSnapshot?.effectiveFrom || "",
    businessSettingsSnapshot,
    calculationSnapshot,
    breakdown: calculationSnapshot && typeof calculationSnapshot === "object" && Array.isArray((calculationSnapshot as any).breakdown) ? (calculationSnapshot as any).breakdown : []
  });

  appendChunkedDataJson("activity/feed.json", {
    id: makeId("event"),
    createdAt,
    type: "lead_created",
    title: "Заявка с сайта",
    clientId: client.id,
    leadId: lead.id,
    source: lead.source,
    partnerRef: lead.partnerRef,
    text: lead.car || lead.comment || lead.name || lead.phone || lead.telegram
  });

  const cpaEvent = appendChunkedDataJson("cpa/events.json", {
    id: makeId("cpa"),
    createdAt,
    direction: "outbound",
    eventType: "lead_created",
    status: "new",
    deliveryStatus: attribution.externalClickId || attribution.partnerRef ? "pending" : "not_required",
    attempts: 0,
    nextAttemptAt: null,
    leadId,
    clientId,
    ...attribution
  });

  if (cpaEvent.deliveryStatus === "pending") {
    await deliverCpaEvent(cpaEvent);
  }

  return NextResponse.json({ ok: true, lead });
}
