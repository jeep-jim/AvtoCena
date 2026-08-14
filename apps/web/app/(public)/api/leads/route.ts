import crypto from "node:crypto";
import { NextResponse } from "next/server";
import {
  appendChunkedDataJson,
  readChunkedDataJson
} from "@/lib/data";
import { getOffer } from "@/lib/catalog/storage";
import { presentCatalogOffer } from "@/lib/catalog/presentation";
import { catalogMarketLabel } from "@/lib/catalog/runtime-config";
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
    referrer: clean(source.referrer || body.referrer, 1500)
  };
}

function truthy(value: unknown) {
  return value === true || value === 1 || value === "1" || String(value || "").toLowerCase() === "true";
}

function telegramContact(value: unknown) {
  return clean(value, 160).replace(/^@+/, "");
}

function normalizeContactPreference(value: unknown) {
  const normalized = clean(value, 40).toLowerCase();
  if (normalized === "chat" || normalized === "message") return "message";
  if (normalized === "call") return "call";
  return normalized;
}

function normalizeSelectedOfferIds(value: unknown, primaryOfferId?: string) {
  const ids = Array.isArray(value) ? value.map((item) => clean(item, 200)).filter(Boolean) : [];
  if (primaryOfferId) ids.unshift(primaryOfferId);
  return [...new Set(ids)].slice(0, 5);
}

function selectedOfferTitle(offer: any) {
  const presented = presentCatalogOffer(offer);
  return clean(presented.title, 500)
    || [offer.make, offer.model, offer.trim, offer.year].filter(Boolean).join(" ");
}

async function buildSelectedOfferSnapshot(offerId: string) {
  const offer = await getOffer(offerId);
  if (!offer) return null;
  const title = selectedOfferTitle(offer);
  const calculationSnapshot = offer.calculationSnapshot && typeof offer.calculationSnapshot === "object"
    ? offer.calculationSnapshot
    : null;
  const totalRub = numberOrNull(offer.totalRub)
    || numberOrNull((calculationSnapshot as any)?.totalRub);

  return {
    id: offer.id,
    offerId: offer.id,
    title,
    href: `https://avtocena.com/cars/offer/${encodeURIComponent(offer.id)}`,
    image: offer.images?.[0]?.url || "",
    market: offer.market || "",
    marketLabel: catalogMarketLabel(offer.market),
    make: offer.make || "",
    model: offer.model || "",
    trim: offer.trim || "",
    year: numberOrNull(offer.year),
    mileageKm: numberOrNull(offer.mileageKm),
    engineCc: numberOrNull(offer.engineCc),
    powerHp: numberOrNull(offer.powerHp),
    power30MinKw: numberOrNull(offer.power30MinKw),
    fuel: offer.fuel || "",
    transmission: offer.transmission || "",
    drive: offer.drive || "",
    bodyType: offer.bodyType || "",
    totalRub,
    sourcePrice: offer.sourcePrice || null,
    calculationSnapshot,
    breakdown: calculationSnapshot && Array.isArray((calculationSnapshot as any).breakdown)
      ? (calculationSnapshot as any).breakdown
      : [],
    updatedAt: offer.updatedAt || ""
  };
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

  const currentUser = getCurrentUser();
  const crmUser = currentUser && isCrmRole(currentUser.role) ? currentUser : null;
  const phone = clean(body.phone, 80);
  const telegram = telegramContact(body.telegram) || telegramContact(body.telegramUsername);
  const max = clean(body.max, 160);
  const name = clean(body.name, 300);
  const city = clean(body.city, 300);
  const comment = clean(body.comment, 2000) || clean(body.message, 2000);
  const contactPreference = normalizeContactPreference(body.contactPreference || body.contactMode);
  const messenger = clean(body.messenger, 40).toLowerCase();
  const personalDataConsentVersion = clean(body.personalDataConsentVersion, 120)
    || clean(body.consentPersonalDataVersion, 120);
  const personalDataConsentText = clean(body.personalDataConsentText, 4000)
    || clean(body.consentPersonalDataText, 4000);
  const personalDataConsent = truthy(body.personalDataConsent ?? body.consentPersonalData);
  const requestedPrimaryOfferId = clean(body.offerId, 200);
  const selectedOfferIds = normalizeSelectedOfferIds(body.selectedOfferIds, requestedPrimaryOfferId);
  const selectedOfferSnapshots = (await Promise.all(selectedOfferIds.map(buildSelectedOfferSnapshot)))
    .filter((item): item is NonNullable<Awaited<ReturnType<typeof buildSelectedOfferSnapshot>>> => Boolean(item));
  const primaryOffer = selectedOfferSnapshots.find((item) => item.id === requestedPrimaryOfferId)
    || selectedOfferSnapshots[0]
    || null;
  const primaryOfferId = primaryOffer?.id || requestedPrimaryOfferId;

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

  if (contactPreference === "message" && messenger === "telegram" && !telegram) {
    return NextResponse.json(
      { ok: false, error: "telegram_required" },
      { status: 400 }
    );
  }

  if (contactPreference === "message" && messenger === "max" && !max && !phone) {
    return NextResponse.json(
      { ok: false, error: "max_contact_required" },
      { status: 400 }
    );
  }

  if (contactPreference === "message" && !telegram && !max && !phone) {
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
  const rawOperationId = clean(body.operationId, 120)
    || crypto.createHash("sha256").update(`${primaryOfferId}:${phone}:${telegram}:${max}`).digest("hex").slice(0, 32);
  const operationId = rawOperationId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
  const clientId = operationId ? `client_${operationId}` : makeId("client");
  const leadId = operationId ? `lead_${operationId}` : makeId("lead");
  const attribution = normalizeAttribution(body.attribution, body);
  const source = clean(body.source, 160) || (crmUser ? "manual_crm" : "site");
  const market = clean(body.market, 120) || primaryOffer?.market || "";
  const businessSettingsSnapshot = market ? await getBusinessSettingsSnapshot(market) : null;
  const pageUrl = clean(body.pageUrl, 1500)
    || clean(request.headers.get("referer"), 1500);
  const referrer = clean(body.referrer, 1500)
    || clean(request.headers.get("referer"), 1500);
  const calculationSnapshot = primaryOffer?.calculationSnapshot
    || (body.calculationSnapshot && typeof body.calculationSnapshot === "object" ? body.calculationSnapshot : null);
  const existingClients = await readChunkedDataJson<any>("clients/clients.json", []);
  const existingLeads = await readChunkedDataJson<any>("leads/leads.json", []);
  const duplicate = operationId ? existingLeads.find((lead) => lead.operationId === operationId || lead.id === leadId) : null;
  const existingClient = operationId ? existingClients.find((client) => client.operationId === operationId || client.id === clientId || client.id === duplicate?.clientId) : null;

  const consentSnapshot = personalDataConsentVersion || personalDataConsentText ? {
    personalDataConsent,
    personalDataConsentVersion,
    personalDataConsentText,
    personalDataConsentAt: personalDataConsent ? createdAt : "",
  } : {};

  const createdByManagerId = crmUser?.id || null;
  const requestedManagerId = crmUser ? clean(body.assignedManagerId, 160) : "";
  const assignedManagerId = requestedManagerId || (crmUser?.role === "manager" ? crmUser.id : null);
  const selectedOfferTitles = selectedOfferSnapshots.map((item) => item.title).filter(Boolean);
  const leadCarTitle = clean(body.car, 500)
    || (selectedOfferTitles.length > 1
      ? `${selectedOfferTitles[0]} + ещё ${selectedOfferTitles.length - 1}`
      : selectedOfferTitles[0] || "");

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
    pageUrl,
    referrer,
    ...consentSnapshot,
    source,
    partnerRef: attribution.partnerRef,
    attribution,
    createdByManagerId,
    assignedManagerId,
    selectedOfferIds: selectedOfferSnapshots.map((item) => item.id),
    selectedOffers: selectedOfferSnapshots,
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
    status: assignedManagerId ? "assigned" : "new",
    statusHistory: [
      {
        status: assignedManagerId ? "assigned" : "new",
        changedAt: createdAt,
        changedByUserId: crmUser?.id || null,
        changedByName: crmUser?.displayName || "Сайт",
        note: crmUser ? "Заявка создана вручную в CRM" : "Заявка создана с сайта"
      }
    ],
    managerHistory: assignedManagerId ? [{
      assignedManagerId,
      changedAt: createdAt,
      changedByUserId: crmUser?.id || null,
      changedByName: crmUser?.displayName || "Сайт"
    }] : [],
    clientId: client.id,
    name,
    phone,
    telegram,
    max,
    city,
    comment,
    contactPreference,
    messenger,
    pageUrl,
    referrer,
    ...consentSnapshot,
    selectedOfferIds: selectedOfferSnapshots.map((item) => item.id),
    selectedOffers: selectedOfferSnapshots,
    carId: primaryOfferId || clean(body.carId, 200),
    offerId: primaryOfferId,
    offerUrl: primaryOffer?.href || "",
    offerTitle: primaryOffer?.title || "",
    offerImageUrl: primaryOffer?.image || "",
    offerMarket: primaryOffer?.market || "",
    offerUpdatedAt: primaryOffer?.updatedAt || "",
    offerSnapshot: primaryOffer,
    car: leadCarTitle,
    brand: clean(body.brand, 200) || primaryOffer?.make || "",
    model: clean(body.model, 200) || primaryOffer?.model || "",
    market,
    marketName: clean(body.marketName, 200) || primaryOffer?.marketLabel || "",
    year: numberOrNull(body.year) || primaryOffer?.year || null,
    budgetRub: numberOrNull(body.budgetRub),
    totalRub: numberOrNull(body.totalRub) || primaryOffer?.totalRub || null,
    source,
    ...attribution,
    attribution: {
      ...attribution,
      landingPage: pageUrl || attribution.lastLandingUrl || attribution.firstLandingUrl,
      referrer,
      offerId: primaryOfferId
    },
    createdByManagerId,
    assignedManagerId,
    configVersion: businessSettingsSnapshot?.configVersion || "",
    effectiveFrom: businessSettingsSnapshot?.effectiveFrom || "",
    businessSettingsSnapshot,
    calculationSnapshot,
    breakdown: calculationSnapshot && typeof calculationSnapshot === "object" && Array.isArray((calculationSnapshot as any).breakdown) ? (calculationSnapshot as any).breakdown : []
  };
  const lead = duplicate || await appendChunkedDataJson("leads/leads.json", leadPayload);

  if (!duplicate) {
    await appendChunkedDataJson("activity/feed.json", {
      id: operationId ? `event_${operationId}` : makeId("event"),
      operationId,
      createdAt,
      type: "lead_created",
      title: crmUser ? "Заявка создана вручную" : "Заявка с сайта",
      clientId: client.id,
      leadId: lead.id,
      source: lead.source,
      partnerRef: lead.partnerRef,
      managerId: crmUser?.id || null,
      managerName: crmUser?.displayName || "",
      text: lead.car || lead.comment || lead.name || lead.phone || lead.telegram || lead.max
    });
  }

  if (!duplicate && !crmUser) {
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
  }

  return NextResponse.json({
    ok: true,
    lead,
    client,
    recovered: Boolean(duplicate),
    duplicate: Boolean(duplicate),
    selectedOfferCount: selectedOfferSnapshots.length
  });
}
