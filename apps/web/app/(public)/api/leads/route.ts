import crypto from "node:crypto";
import { NextResponse } from "next/server";
import {
  appendChunkedDataJson,
  mutateDataJson,
  readChunkedDataJson
} from "@/lib/data";
import { getOffer, publicOffer } from "@/lib/catalog/storage";
import { deliverCpaEvent } from "@/lib/cpa-gateway";
import { getBusinessSettingsSnapshot } from "@/lib/business-settings";
import { getCurrentUser, isCrmRole } from "@/lib/auth";

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

function truthy(value: unknown) {
  return value === true || value === 1 || value === "1" || String(value || "").toLowerCase() === "true";
}

function normalizeSelectedOfferIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => clean(item, 200)).filter(Boolean))].slice(0, 5);
}

function normalizeSelectedOffers(value: unknown, allowedIds: string[]) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 5).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const id = clean(row.id, 200);
    if (!id || (allowedIds.length && !allowedIds.includes(id))) return [];
    return [{
      id,
      title: clean(row.title, 500),
      totalRub: numberOrNull(row.totalRub),
      year: numberOrNull(row.year),
      marketLabel: clean(row.marketLabel, 160),
      href: clean(row.href, 600),
    }];
  });
}

export async function GET() {
  const user = getCurrentUser();
  if (!isCrmRole(user?.role)) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const leads = await readChunkedDataJson<any>("leads/leads.json", []);
  return NextResponse.json({ ok: true, leads });
}

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") || "";
  const body = contentType.includes("application/x-www-form-urlencoded")
    ? Object.fromEntries((await request.formData()).entries()) as Record<string, unknown>
    : await request.json().catch(() => ({})) as Record<string, unknown>;

  const phone = clean(body.phone, 80);
  const telegram = clean(body.telegram, 160);
  const max = clean(body.max, 160);
  const name = clean(body.name, 300);
  const city = clean(body.city, 300);
  const comment = clean(body.comment, 2000);
  const contactPreference = clean(body.contactPreference, 40);
  const messenger = clean(body.messenger, 40);
  const personalDataConsentVersion = clean(body.personalDataConsentVersion, 120);
  const personalDataConsent = truthy(body.personalDataConsent);
  const selectedOfferIds = normalizeSelectedOfferIds(body.selectedOfferIds);
  const selectedOffers = normalizeSelectedOffers(body.selectedOffers, selectedOfferIds);

  if (personalDataConsentVersion && !personalDataConsent) {
    return NextResponse.json(
      { ok: false, error: "personal_data_consent_required" },
      { status: 400 }
    );
  }

  if (contactPreference === "call" && !phone) {
    return NextResponse.json(
      { ok: false, error: "phone_required" },
      { status: 400 }
    );
  }

  if (contactPreference === "message" && !telegram && !max) {
    return NextResponse.json(
      { ok: false, error: "messenger_contact_required" },
      { status: 400 }
    );
  }

  if (!phone && !telegram && !max) {
    return NextResponse.json(
      { ok: false, error: "phone_or_messenger_required" },
      { status: 400 }
    );
  }

  const createdAt = new Date().toISOString();
  const rawOperationId = clean(body.operationId, 120) || crypto.createHash("sha256").update(`${clean(body.offerId, 200)}:${phone}:${telegram}:${max}`).digest("hex").slice(0, 32);
  const operationId = rawOperationId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
  const clientId = operationId ? `client_${operationId}` : makeId("client");
  const leadId = operationId ? `lead_${operationId}` : makeId("lead");
  const attribution = normalizeAttribution(body.attribution, body);
  const source = clean(body.source, 160) || "site";
  const market = clean(body.market, 120);
  const businessSettingsSnapshot = market ? await getBusinessSettingsSnapshot(market) : null;
  const offerId = clean(body.offerId, 200);
  const offer = offerId ? await getOffer(offerId) : null;
  const offerSnapshot = offer ? {
    offerId: offer.id,
    market: offer.market,
    make: offer.make,
    model: offer.model,
    year: offer.year,
    mileage: offer.mileageKm,
    image: offer.images[0]?.url,
    totalRub: offer.totalRub,
    sourcePrice: offer.sourcePrice,
    calculationSnapshot: offer.calculationSnapshot,
    updatedAt: offer.updatedAt
  } : null;
  const calculationSnapshot = offerSnapshot?.calculationSnapshot || (body.calculationSnapshot && typeof body.calculationSnapshot === "object" ? body.calculationSnapshot : null);
  const existingClients = await readChunkedDataJson<any>("clients/clients.json", []);
  const existingLeads = await readChunkedDataJson<any>("leads/leads.json", []);
  const duplicate = operationId ? existingLeads.find((lead) => lead.operationId === operationId || lead.id === leadId) : null;
  const existingClient = operationId ? existingClients.find((client) => client.operationId === operationId || client.id === clientId || client.id === duplicate?.clientId) : null;

  const consentSnapshot = personalDataConsentVersion ? {
    personalDataConsent,
    personalDataConsentVersion,
    personalDataConsentAt: personalDataConsent ? createdAt : "",
  } : {};

  const clientPayload = {
    id: clientId,
    operationId,
    createdAt,
    updatedAt: createdAt,
    fio: name,
    phone,
    telegram,
    max,
    city,
    comment,
    contactPreference,
    messenger,
    ...consentSnapshot,
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
  };
  const client = existingClient || await appendChunkedDataJson("clients/clients.json", { ...clientPayload, id: duplicate?.clientId || clientId });

  const leadPayload = {
    id: leadId,
    operationId,
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
    clientId: client.id,
    name,
    phone,
    telegram,
    max,
    city,
    comment,
    contactPreference,
    messenger,
    ...consentSnapshot,
    selectedOfferIds,
    selectedOffers,
    carId: offerId || clean(body.carId, 200),
    offerId,
    offerSnapshot,
    car: clean(body.car, 500) || (offer ? `${offer.make} ${offer.model}` : ""),
    brand: clean(body.brand, 200) || offer?.make || "",
    model: clean(body.model, 200) || offer?.model || "",
    market: market || offer?.market || "",
    marketName: clean(body.marketName, 200),
    year: numberOrNull(body.year) || offer?.year || null,
    budgetRub: numberOrNull(body.budgetRub),
    totalRub: numberOrNull(body.totalRub) || offer?.totalRub || null,
    source,
    ...attribution,
    attribution: { ...attribution, landingPage: attribution.lastLandingUrl || attribution.firstLandingUrl, offerId },
    createdByManagerId: null,
    assignedManagerId: null,
    configVersion: businessSettingsSnapshot?.configVersion || "",
    effectiveFrom: businessSettingsSnapshot?.effectiveFrom || "",
    businessSettingsSnapshot,
    calculationSnapshot,
    breakdown: calculationSnapshot && typeof calculationSnapshot === "object" && Array.isArray((calculationSnapshot as any).breakdown) ? (calculationSnapshot as any).breakdown : []
  };
  const lead = duplicate || await appendChunkedDataJson("leads/leads.json", leadPayload);

  await appendChunkedDataJson("activity/feed.json", {
    id: operationId ? `event_${operationId}` : makeId("event"),
    operationId,
    createdAt,
    type: "lead_created",
    title: "Заявка с сайта",
    clientId: client.id,
    leadId: lead.id,
    source: lead.source,
    partnerRef: lead.partnerRef,
    text: lead.car || lead.comment || lead.name || lead.phone || lead.telegram || lead.max
  });

  const cpaEvent = await appendChunkedDataJson("cpa/events.json", {
    id: operationId ? `cpa_${operationId}` : makeId("cpa"),
    operationId,
    createdAt,
    direction: "outbound",
    eventType: "lead_created",
    status: "new",
    deliveryStatus: attribution.externalClickId || attribution.partnerRef ? "pending" : "not_required",
    attempts: 0,
    nextAttemptAt: null,
    leadId,
    clientId: client.id,
    ...attribution
  });

  const cpaRetryStatuses = new Set(["pending", "failed", "waiting_config"]);
  const retryDue = !cpaEvent.nextAttemptAt || Date.parse(cpaEvent.nextAttemptAt) <= Date.now();
  if (cpaRetryStatuses.has(cpaEvent.deliveryStatus) && retryDue) {
    await deliverCpaEvent(cpaEvent);
  }

  return NextResponse.json({ ok: true, lead, client, recovered: Boolean(duplicate), duplicate: Boolean(duplicate) });
}
