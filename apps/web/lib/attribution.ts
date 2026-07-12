export const ATTRIBUTION_STORAGE_KEY = "avtocena_attribution";
const ATTRIBUTION_SESSION_CLICK_KEY = "avtocena_session_click_id";

export type AttributionData = {
  clickId: string;
  externalClickId: string;
  partnerRef: string;
  sub1: string;
  sub2: string;
  sub3: string;
  sub4: string;
  sub5: string;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  utmContent: string;
  utmTerm: string;
  firstSeenAt: string;
  lastSeenAt: string;
  firstLandingUrl: string;
  lastLandingUrl: string;
  referrer: string;
};

function clean(value: unknown) {
  return typeof value === "string" ? value.trim().slice(0, 500) : "";
}

function readParam(params: URLSearchParams, ...names: string[]) {
  for (const name of names) {
    const value = clean(params.get(name));
    if (value) return value;
  }
  return "";
}

function makeClickId() {
  try {
    return crypto.randomUUID();
  } catch {
    return `click_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }
}

export function emptyAttribution(): AttributionData {
  return {
    clickId: "",
    externalClickId: "",
    partnerRef: "",
    sub1: "",
    sub2: "",
    sub3: "",
    sub4: "",
    sub5: "",
    utmSource: "",
    utmMedium: "",
    utmCampaign: "",
    utmContent: "",
    utmTerm: "",
    firstSeenAt: "",
    lastSeenAt: "",
    firstLandingUrl: "",
    lastLandingUrl: "",
    referrer: ""
  };
}

export function normalizeAttribution(value: Partial<AttributionData> | null | undefined): AttributionData {
  const fallback = emptyAttribution();
  const source = value ?? {};

  return Object.fromEntries(
    Object.keys(fallback).map((key) => [key, clean(source[key as keyof AttributionData])])
  ) as AttributionData;
}

export function readStoredAttribution(): AttributionData {
  if (typeof window === "undefined") return emptyAttribution();

  try {
    return normalizeAttribution(JSON.parse(window.localStorage.getItem(ATTRIBUTION_STORAGE_KEY) || "{}"));
  } catch {
    return emptyAttribution();
  }
}

export function captureAttributionFromBrowser(seed?: Partial<AttributionData>): AttributionData {
  if (typeof window === "undefined") return normalizeAttribution(seed);

  const now = new Date().toISOString();
  const params = new URLSearchParams(window.location.search);
  const stored = readStoredAttribution();
  const seeded = normalizeAttribution(seed);

  const incoming = {
    externalClickId: readParam(params, "click_id", "clickid", "external_click_id") || seeded.externalClickId,
    partnerRef: readParam(params, "ref", "partner_id", "partner", "aff_id") || seeded.partnerRef,
    sub1: readParam(params, "sub1", "subid") || seeded.sub1,
    sub2: readParam(params, "sub2") || seeded.sub2,
    sub3: readParam(params, "sub3") || seeded.sub3,
    sub4: readParam(params, "sub4") || seeded.sub4,
    sub5: readParam(params, "sub5") || seeded.sub5,
    utmSource: readParam(params, "utm_source") || seeded.utmSource,
    utmMedium: readParam(params, "utm_medium") || seeded.utmMedium,
    utmCampaign: readParam(params, "utm_campaign") || seeded.utmCampaign,
    utmContent: readParam(params, "utm_content") || seeded.utmContent,
    utmTerm: readParam(params, "utm_term") || seeded.utmTerm
  };

  const hasIncomingAttribution = Object.values(incoming).some(Boolean);
  const incomingChanged = hasIncomingAttribution && [
    [incoming.externalClickId, stored.externalClickId],
    [incoming.partnerRef, stored.partnerRef],
    [incoming.sub1, stored.sub1],
    [incoming.utmSource, stored.utmSource],
    [incoming.utmCampaign, stored.utmCampaign],
  ].some(([nextValue, previousValue]) => Boolean(nextValue) && nextValue !== previousValue);

  const sessionClickId = clean(window.sessionStorage.getItem(ATTRIBUTION_SESSION_CLICK_KEY));
  const clickId = incomingChanged || !sessionClickId
    ? makeClickId()
    : sessionClickId;

  window.sessionStorage.setItem(ATTRIBUTION_SESSION_CLICK_KEY, clickId);

  const isNewClick = clickId !== stored.clickId;
  const attribution: AttributionData = {
    clickId,
    externalClickId: incoming.externalClickId || stored.externalClickId,
    partnerRef: incoming.partnerRef || stored.partnerRef,
    sub1: incoming.sub1 || stored.sub1,
    sub2: incoming.sub2 || stored.sub2,
    sub3: incoming.sub3 || stored.sub3,
    sub4: incoming.sub4 || stored.sub4,
    sub5: incoming.sub5 || stored.sub5,
    utmSource: incoming.utmSource || stored.utmSource,
    utmMedium: incoming.utmMedium || stored.utmMedium,
    utmCampaign: incoming.utmCampaign || stored.utmCampaign,
    utmContent: incoming.utmContent || stored.utmContent,
    utmTerm: incoming.utmTerm || stored.utmTerm,
    firstSeenAt: isNewClick ? now : stored.firstSeenAt || seeded.firstSeenAt || now,
    lastSeenAt: now,
    firstLandingUrl: isNewClick
      ? window.location.href
      : stored.firstLandingUrl || seeded.firstLandingUrl || window.location.href,
    lastLandingUrl: window.location.href,
    referrer: isNewClick
      ? clean(document.referrer)
      : stored.referrer || seeded.referrer || clean(document.referrer)
  };

  if (Object.values(attribution).some(Boolean)) {
    window.localStorage.setItem(ATTRIBUTION_STORAGE_KEY, JSON.stringify(attribution));
    if (attribution.partnerRef) window.localStorage.setItem("avtocena_ref", attribution.partnerRef);
  }

  return attribution;
}

export function appendAttributionToSearchParams(params: URLSearchParams, attribution?: Partial<AttributionData>) {
  const data = typeof window === "undefined"
    ? normalizeAttribution(attribution)
    : captureAttributionFromBrowser(attribution);

  const values: Array<[string, string]> = [
    ["ref", data.partnerRef],
    ["click_id", data.externalClickId],
    ["sub1", data.sub1],
    ["sub2", data.sub2],
    ["sub3", data.sub3],
    ["sub4", data.sub4],
    ["sub5", data.sub5],
    ["utm_source", data.utmSource],
    ["utm_medium", data.utmMedium],
    ["utm_campaign", data.utmCampaign],
    ["utm_content", data.utmContent],
    ["utm_term", data.utmTerm]
  ];

  values.forEach(([key, value]) => {
    if (value) params.set(key, value);
  });

  return data;
}

export async function trackAttributionEvent(
  eventType: "visit" | "calculation_completed",
  attribution: AttributionData,
  payload: Record<string, unknown> = {}
) {
  if (typeof window === "undefined" || !attribution.clickId) return;

  const calculationKey = clean(payload.calculationKey);
  const dedupeKey = `avtocena_event_${eventType}_${attribution.clickId}_${calculationKey}`;

  if (window.sessionStorage.getItem(dedupeKey)) return;
  window.sessionStorage.setItem(dedupeKey, "1");

  try {
    await fetch("/api/cpa", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({
        eventType,
        attribution,
        pageUrl: window.location.href,
        ...payload
      })
    });
  } catch {
    window.sessionStorage.removeItem(dedupeKey);
  }
}
