import type { CatalogFetchResult, CatalogImage, CatalogSourceAdapter, SourceRunHealth, VehicleOffer } from "./types";

const DEFAULT_ORIGIN = "https://avtocena.com";

type BridgeKind = "dubizzle" | "encar" | "goonet" | "guazi" | "myauto" | "autopapa";

type BridgePayload = {
  sourceId?: string;
  market?: string;
  count?: number;
  partial?: boolean;
  nextCursor?: string | null;
  finished?: boolean;
  report?: Record<string, unknown>;
  offers?: unknown[];
  error?: string;
  causeCode?: string;
};

function bridgeErrorDetail(payload: BridgePayload) {
  return String(payload.error || payload.causeCode || "")
    .replace(/[^a-zA-Z0-9_.:-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 180);
}

function githubBridgeEnabled() {
  return /^(?:1|true|yes)$/i.test(String(process.env.GITHUB_ACTIONS || ""))
    && !/^(?:1|true|yes)$/i.test(String(process.env.CATALOG_DISABLE_YANDEX_SOURCE_BRIDGE || ""));
}

function bridgeOrigin() {
  const configured = String(process.env.CATALOG_YANDEX_SOURCE_BRIDGE_ORIGIN || DEFAULT_ORIGIN).trim();
  try {
    const url = new URL(configured);
    if (url.protocol !== "https:") return DEFAULT_ORIGIN;
    return url.origin;
  } catch {
    return DEFAULT_ORIGIN;
  }
}

function boundedPage(cursor?: string | null) {
  const page = Math.floor(Number(cursor || 1));
  return Number.isFinite(page) ? Math.max(1, Math.min(10_000, page)) : 1;
}

function bridgeUrl(kind: BridgeKind, page: number) {
  const origin = bridgeOrigin();
  if (kind === "dubizzle") return `${origin}/api/internal/dubizzle-egress-a4c907?page=${page}`;
  if (kind === "encar") return `${origin}/api/internal/encar-egress-71b8e4?page=${page}`;
  if (kind === "goonet") return `${origin}/api/internal/goonet-egress-f7c2a9?page=${page}`;
  if (kind === "guazi") return `${origin}/api/internal/guazi-egress-b8c4d1?page=${page}`;
  return `${origin}/api/internal/georgia-recovery-e2f913?source=${kind}&pages=1&startPage=${page}`;
}

function asVehicleOffer(value: unknown, sourceId: string): VehicleOffer | null {
  const offer = value as VehicleOffer;
  return offer
    && typeof offer === "object"
    && String(offer.sourceId || "") === sourceId
    && String(offer.id || "")
    && String(offer.market || "")
    && Number(offer.sourcePrice || 0) > 0
    && Array.isArray(offer.images)
    ? offer
    : null;
}

async function fetchPayload(kind: BridgeKind, page: number): Promise<{ response: Response; payload: BridgePayload }> {
  const response = await fetch(bridgeUrl(kind, page), {
    headers: {
      accept: "application/json",
      "accept-language": "en-US,en;q=0.9",
      "user-agent": "AvtoCena-Catalog-Collector/1.0",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(Math.max(20_000, Number(process.env.CATALOG_SOURCE_TIMEOUT_MS || 35_000))),
  });
  const text = await response.text();
  let payload: BridgePayload;
  try { payload = JSON.parse(text) as BridgePayload; }
  catch { throw new Error(`yandex_bridge_non_json_${response.status}_${kind}_${page}`); }
  if (!response.ok) {
    const detail = bridgeErrorDetail(payload);
    throw new Error(`yandex_bridge_http_${response.status}_${kind}_${page}${detail ? `_${detail}` : ""}`);
  }
  return { response, payload };
}

export function withGithubYandexSourceBridge<T extends CatalogSourceAdapter>(source: T, kind: BridgeKind): T {
  if (!githubBridgeEnabled()) return source;
  const sourceId = source.sourceId;
  const market = source.market;

  const bridge: CatalogSourceAdapter = {
    sourceId,
    market,
    accessMode: "public_json",

    async fetchPage(cursor?: string | null): Promise<CatalogFetchResult> {
      const page = boundedPage(cursor);
      const { response, payload } = await fetchPayload(kind, page);
      const offers = (Array.isArray(payload.offers) ? payload.offers : [])
        .map((value) => asVehicleOffer(value, sourceId))
        .filter((value): value is VehicleOffer => Boolean(value));
      const nextCursor = payload.finished === true ? null : String(page + 1);
      return {
        items: offers,
        nextCursor,
        finished: payload.finished === true,
        count: Number(payload.count || offers.length),
        health: {
          ok: offers.length > 0,
          message: `Yandex ${kind} bridge page ${page}: ${offers.length}`,
          checkedAt: new Date().toISOString(),
          httpStatus: response.status,
          contentType: response.headers.get("content-type") || "application/json",
        },
      };
    },

    normalizeOffer(raw: unknown): VehicleOffer | null {
      return asVehicleOffer(raw, sourceId) || source.normalizeOffer(raw);
    },

    async fetchImages(offer: VehicleOffer): Promise<CatalogImage[]> {
      const existing = Array.isArray(offer.images) ? offer.images : [];
      const operational = offer.operational as Record<string, unknown> | undefined;
      if (existing.length && (operational?.photoIdentityVerified === true || operational?.galleryVerified === true)) return existing.slice(0, 30);
      return source.fetchImages(offer);
    },

    mapStatus(raw: unknown) {
      return source.mapStatus(raw);
    },

    async healthCheck(): Promise<SourceRunHealth> {
      try {
        const page = await bridge.fetchPage(null);
        return page.health || { ok: false, message: `Yandex ${kind} bridge missing health`, checkedAt: new Date().toISOString() };
      } catch (error) {
        return { ok: false, message: String((error as Error)?.message || error), checkedAt: new Date().toISOString(), blocked: true };
      }
    },
  };

  return bridge as T;
}
