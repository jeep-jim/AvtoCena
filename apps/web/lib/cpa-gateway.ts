import { readChunkedDataJson, readDataJson, updateChunkedDataJson } from "./data";

type CpaNetworkConfig = {
  id: string;
  name: string;
  enabled: boolean;
  partnerRef: string;
  method?: "GET" | "POST";
  postbackUrl: string;
  headers?: Record<string, string>;
  payoutRub?: number;
  timeoutMs?: number;
  statusMap?: Record<string, string>;
};

type CpaEvent = {
  id: string;
  direction?: string;
  eventType?: string;
  deliveryStatus?: string;
  attempts?: number;
  nextAttemptAt?: string | null;
  clickId?: string;
  externalClickId?: string;
  partnerRef?: string;
  sub1?: string;
  sub2?: string;
  sub3?: string;
  sub4?: string;
  sub5?: string;
  leadId?: string;
  status?: string;
  rejectionReason?: string;
  [key: string]: unknown;
};

export type CpaDeliveryResult = {
  ok: boolean;
  eventId: string;
  skipped?: boolean;
  reason?: string;
  responseStatus?: number | null;
};

function clean(value: unknown, maxLength = 2000) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function findNetwork(event: CpaEvent) {
  const networks = readDataJson<CpaNetworkConfig[]>("cpa/networks.json", []);
  return networks.find(
    (network) => network.enabled && network.partnerRef === clean(event.partnerRef, 160),
  );
}

function eventStatus(event: CpaEvent, config: CpaNetworkConfig) {
  const source = clean(event.status || event.eventType, 100);
  return config.statusMap?.[source] || config.statusMap?.[clean(event.eventType, 100)] || source;
}

function templateValues(event: CpaEvent, config: CpaNetworkConfig) {
  return {
    click_id: clean(event.externalClickId || event.clickId, 500),
    internal_click_id: clean(event.clickId, 500),
    partner_id: clean(event.partnerRef, 300),
    lead_id: clean(event.leadId, 300),
    event: clean(event.eventType, 100),
    status: eventStatus(event, config),
    payout: String(Number(config.payoutRub || 0)),
    rejection_reason: clean(event.rejectionReason, 1000),
    sub1: clean(event.sub1, 500),
    sub2: clean(event.sub2, 500),
    sub3: clean(event.sub3, 500),
    sub4: clean(event.sub4, 500),
    sub5: clean(event.sub5, 500),
  };
}

function renderTemplate(template: string, values: Record<string, string>) {
  return template.replace(/\{([a-z0-9_]+)\}/gi, (_match, key: string) =>
    encodeURIComponent(values[key] || ""),
  );
}

function retryDelayMinutes(attempts: number) {
  if (attempts <= 1) return 5;
  if (attempts === 2) return 20;
  if (attempts === 3) return 60;
  return 360;
}

export async function deliverCpaEvent(event: CpaEvent): Promise<CpaDeliveryResult> {
  if (!event.id || event.direction !== "outbound") {
    return { ok: false, eventId: event.id || "", skipped: true, reason: "not_outbound" };
  }

  const config = findNetwork(event);
  if (!config) {
    updateChunkedDataJson<CpaEvent>("cpa/events.json", event.id, (stored) => ({
      ...stored,
      deliveryStatus: stored.partnerRef ? "waiting_config" : "not_required",
      lastDeliveryError: stored.partnerRef ? "network_config_not_found" : null,
    }));

    return {
      ok: false,
      eventId: event.id,
      skipped: true,
      reason: "network_config_not_found",
    };
  }

  const values = templateValues(event, config);
  const url = renderTemplate(config.postbackUrl, values);
  const method = config.method || "GET";
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    Math.max(1000, Math.min(Number(config.timeoutMs || 5000), 15000)),
  );
  const attempts = Number(event.attempts || 0) + 1;
  const attemptedAt = new Date().toISOString();

  try {
    const response = await fetch(url, {
      method,
      headers: {
        accept: "application/json, text/plain, */*",
        ...(config.headers || {}),
        ...(method === "POST" ? { "content-type": "application/json" } : {}),
      },
      body: method === "POST" ? JSON.stringify(values) : undefined,
      signal: controller.signal,
      cache: "no-store",
    });
    const body = clean(await response.text().catch(() => ""), 2000);
    const delivered = response.ok;
    const nextAttemptAt = delivered
      ? null
      : new Date(Date.now() + retryDelayMinutes(attempts) * 60_000).toISOString();

    updateChunkedDataJson<CpaEvent>("cpa/events.json", event.id, (stored) => ({
      ...stored,
      deliveryStatus: delivered ? "sent" : "failed",
      attempts,
      lastAttemptAt: attemptedAt,
      nextAttemptAt,
      networkId: config.id,
      networkName: config.name,
      responseStatus: response.status,
      responseBody: body,
      lastDeliveryError: delivered ? null : `http_${response.status}`,
      deliveredAt: delivered ? attemptedAt : stored.deliveredAt || null,
    }));

    return {
      ok: delivered,
      eventId: event.id,
      responseStatus: response.status,
      reason: delivered ? undefined : `http_${response.status}`,
    };
  } catch (error) {
    const reason = error instanceof Error ? clean(error.message, 500) : "delivery_failed";
    const nextAttemptAt = new Date(
      Date.now() + retryDelayMinutes(attempts) * 60_000,
    ).toISOString();

    updateChunkedDataJson<CpaEvent>("cpa/events.json", event.id, (stored) => ({
      ...stored,
      deliveryStatus: "failed",
      attempts,
      lastAttemptAt: attemptedAt,
      nextAttemptAt,
      networkId: config.id,
      networkName: config.name,
      responseStatus: null,
      responseBody: "",
      lastDeliveryError: reason,
    }));

    return {
      ok: false,
      eventId: event.id,
      responseStatus: null,
      reason,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function deliverCpaEventById(eventId: string) {
  const event = readChunkedDataJson<CpaEvent>("cpa/events.json", []).find(
    (item) => item.id === eventId,
  );

  if (!event) {
    return { ok: false, eventId, skipped: true, reason: "event_not_found" } satisfies CpaDeliveryResult;
  }

  return deliverCpaEvent(event);
}

export async function deliverPendingCpaEvents(limit = 25) {
  const now = Date.now();
  const events = readChunkedDataJson<CpaEvent>("cpa/events.json", [])
    .filter((event) => {
      if (event.direction !== "outbound") return false;
      if (!["pending", "failed", "waiting_config"].includes(event.deliveryStatus || "")) {
        return false;
      }
      if (!event.nextAttemptAt) return true;
      return new Date(event.nextAttemptAt).getTime() <= now;
    })
    .slice(0, Math.max(1, Math.min(limit, 100)));

  const results: CpaDeliveryResult[] = [];
  for (const event of events) {
    results.push(await deliverCpaEvent(event));
  }

  return results;
}
