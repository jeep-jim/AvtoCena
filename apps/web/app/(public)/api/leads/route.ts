import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { appendChunkedDataJson, readChunkedDataJson } from "@/lib/data";

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

function cleanSearchRequest(value: unknown) {
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};

  return {
    budgetRub: numberOrNull(source.budgetRub),
    brand: clean(source.brand, 120),
    model: clean(source.model, 120),
    yearFrom: numberOrNull(source.yearFrom),
    market: clean(source.market, 80),
    body: clean(source.body, 80)
  };
}

export async function GET() {
  const leads = readChunkedDataJson<any>("leads/leads.json", []);
  return NextResponse.json({ ok: true, leads });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));

  const phone = clean(body.phone, 80);
  const city = clean(body.city, 160);
  const name = clean(body.name, 255);
  const comment = clean(body.comment, 2000);

  if (!phone) {
    return NextResponse.json(
      { ok: false, error: "phone_required" },
      { status: 400 }
    );
  }

  if (!city) {
    return NextResponse.json(
      { ok: false, error: "city_required" },
      { status: 400 }
    );
  }

  const createdAt = new Date().toISOString();
  const clientId = makeId("client");
  const leadId = makeId("lead");
  const attribution = cleanAttribution(body.attribution);
  const searchRequest = cleanSearchRequest(body.searchRequest);
  const source = clean(body.source, 120) || "site";

  const client = appendChunkedDataJson("clients/clients.json", {
    id: clientId,
    createdAt,
    updatedAt: createdAt,
    fio: name,
    phone,
    telegram: "",
    email: "",
    city,
    birthDate: "",
    passport: {
      series: "",
      number: "",
      issuedBy: "",
      issuedAt: "",
      departmentCode: ""
    },
    registrationAddress: "",
    residenceAddress: "",
    inn: "",
    comment,
    source,
    partnerRef: attribution.partnerRef,
    attribution,
    createdByManagerId: null,
    assignedManagerId: null
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
        changedByName: "Система"
      }
    ],

    clientId,
    name,
    phone,
    telegram: "",
    city,
    comment,

    carId: clean(body.carId, 255),
    car: clean(body.car, 255),
    brand: clean(body.brand, 120),
    model: clean(body.model, 120),
    market: clean(body.market, 80),
    marketName: clean(body.marketName, 120),
    year: numberOrNull(body.year),

    budgetRub: numberOrNull(body.budgetRub) || searchRequest.budgetRub,
    totalRub: numberOrNull(body.totalRub),
    searchRequest,

    source,
    partnerRef: attribution.partnerRef,
    clickId: attribution.clickId,
    externalClickId: attribution.externalClickId,
    attribution,
    createdByManagerId: null,
    assignedManagerId: null
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
    clickId: lead.clickId,
    text: lead.car || lead.comment || lead.name || lead.phone || lead.city
  });

  if (attribution.clickId || attribution.partnerRef) {
    appendChunkedDataJson("cpa/events.json", {
      id: makeId("cpa"),
      createdAt,
      eventType: "lead_created",
      clickId: attribution.clickId,
      externalClickId: attribution.externalClickId,
      partnerRef: attribution.partnerRef,
      leadId,
      clientId,
      sub1: attribution.sub1,
      sub2: attribution.sub2,
      sub3: attribution.sub3,
      sub4: attribution.sub4,
      sub5: attribution.sub5,
      utmSource: attribution.utmSource,
      utmMedium: attribution.utmMedium,
      utmCampaign: attribution.utmCampaign
    });
  }

  return NextResponse.json({
    ok: true,
    lead: {
      id: lead.id,
      status: lead.status,
      createdAt: lead.createdAt
    }
  });
}
