import { canonicalSourceFuel } from "./powertrain-safety";
import { stableOfferId } from "./storage";
import type {
  CatalogFetchResult,
  CatalogImage,
  CatalogSourceAdapter,
  OfferStatus,
  PowertrainKind,
  SourceRunHealth,
  VehicleOffer,
} from "./types";

const BASE = "https://carvector.com";
const PAGE_SIZE = 50;
const HEADERS = {
  accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9,ja;q=0.8",
  "cache-control": "no-cache",
  pragma: "no-cache",
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
};

type EvidenceStatus = "exact" | "ambiguous" | "conflict" | "missing";
type Evidence<T> = { value?: T; rawValues: unknown[]; status: EvidenceStatus };
export type CarvectorSpecificationEvidence = {
  year: Evidence<number>;
  fuel: Evidence<string>;
  powertrainKind: Evidence<PowertrainKind>;
  engineCc: Evidence<number>;
  powerHp: Evidence<number>;
  powerKw: Evidence<number>;
};

type CarvectorResult = { total: number; offers: Record<string, any>[] };

function clean(value: unknown) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}
function positiveInteger(value: unknown, minimum: number, maximum: number) {
  const number = Number(value);
  return Number.isInteger(number) && number >= minimum && number <= maximum
    ? number
    : undefined;
}
function positiveNumber(value: unknown, minimum: number, maximum: number) {
  const number = Number(value);
  return Number.isFinite(number) && number >= minimum && number <= maximum
    ? number
    : undefined;
}
function evidence<T>(rawValue: unknown, value: T | undefined): Evidence<T> {
  const rawValues =
    rawValue === undefined || rawValue === null || clean(rawValue) === ""
      ? []
      : [rawValue];
  if (!rawValues.length) return { rawValues, status: "missing" };
  return value === undefined
    ? { rawValues, status: "ambiguous" }
    : { value, rawValues, status: "exact" };
}
function powertrainFromFuel(
  fuel: string | undefined,
): PowertrainKind | undefined {
  if (fuel === "electric") return "electric";
  if (fuel === "hybrid") return "other_hybrid";
  if (fuel === "petrol" || fuel === "diesel" || fuel === "lpg")
    return "combustion";
  return undefined;
}

export function carvectorSpecificationEvidence(
  row: Record<string, any>,
): CarvectorSpecificationEvidence {
  const currentYear = new Date().getUTCFullYear();
  const yearValue = positiveInteger(row?.year, 1980, currentYear + 1);
  const rawFuel = clean(row?.fuel?.title);
  const fuelValue = canonicalSourceFuel(rawFuel);
  const powertrainValue = powertrainFromFuel(fuelValue);
  let engineCc = evidence(
    row?.engineVolume,
    positiveInteger(row?.engineVolume, 300, 10_000),
  );
  let powerHp = evidence(row?.power, positiveNumber(row?.power, 20, 1_500));
  let powerKw: Evidence<number> =
    powerHp.status === "exact"
      ? {
          value: Math.round((Number(powerHp.value) / 1.3596216173) * 10) / 10,
          rawValues: powerHp.rawValues,
          status: "exact",
        }
      : { rawValues: powerHp.rawValues, status: powerHp.status };
  if (powertrainValue && powertrainValue !== "combustion") {
    // CarVector calls this field simply `power`; for electrified cars it does
    // not identify ICE power or certified 30-minute motor power. Preserve the
    // raw value, but never promote it into customs calculation fields.
    powerHp = { rawValues: powerHp.rawValues, status: "missing" };
    powerKw = { rawValues: powerKw.rawValues, status: "missing" };
  }
  if (powertrainValue === "electric" && engineCc.status === "exact") {
    engineCc = { rawValues: engineCc.rawValues, status: "conflict" };
  }
  return {
    year: evidence(row?.year, yearValue),
    fuel: evidence(rawFuel, fuelValue),
    powertrainKind: evidence(rawFuel, powertrainValue),
    engineCc,
    powerHp,
    powerKw,
  };
}

function walkResults(value: unknown, output: CarvectorResult[], depth = 0) {
  if (!value || typeof value !== "object" || depth > 12) return;
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.offers) && Number.isFinite(Number(record.total))) {
    output.push({
      total: Math.max(0, Number(record.total)),
      offers: record.offers.filter((row): row is Record<string, any> =>
        Boolean(row && typeof row === "object"),
      ),
    });
  }
  for (const child of Object.values(record))
    walkResults(child, output, depth + 1);
}

export function parseCarvectorNgState(markup: string): CarvectorResult {
  const encoded =
    String(markup || "").match(
      /<script\b[^>]*id=["']ng-state["'][^>]*>([\s\S]*?)<\/script>/i,
    )?.[1] || "";
  if (!encoded) throw new Error("carvector_ng_state_missing");
  let state: Record<string, unknown>;
  try {
    state = JSON.parse(encoded);
  } catch {
    throw new Error("carvector_ng_state_invalid");
  }
  const context = state.INIT_STATE_PROJECT_CONTEXT as
    Record<string, unknown> | undefined;
  if (context?.rateLimited === true)
    throw new Error(
      `carvector_rate_limited:retryAfter=${Number(context.retryAfterSeconds || 0)}`,
    );
  const results: CarvectorResult[] = [];
  walkResults(state, results);
  const result = results.sort(
    (left, right) => right.offers.length - left.offers.length,
  )[0];
  if (!result) throw new Error("carvector_offers_payload_missing");
  return result;
}

function pageUrl(page: number) {
  const url = new URL(`${BASE}/stat`);
  const query = clean(process.env.CATALOG_CARVECTOR_QUERY);
  if (query) url.searchParams.set("query", query);
  url.searchParams.set("minYear", "2010");
  url.searchParams.set("minPrice", "1");
  url.searchParams.set("minEngineVolume", "400");
  url.searchParams.set("pageSize", String(PAGE_SIZE));
  url.searchParams.set("sortBy", "AUCTION_AT_DESC");
  url.searchParams.set("page", String(Math.max(1, page)));
  return url.toString();
}
function exactSourceUrl(row: Record<string, any>) {
  const id = clean(row?.id).toLowerCase();
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)
  )
    return "";
  try {
    const url = new URL(clean(row?.urlPage?.fullUrl), BASE);
    if (
      url.origin !== BASE ||
      !url.pathname.startsWith("/stat/") ||
      !url.pathname.toLowerCase().endsWith(`/${id}`)
    )
      return "";
    return url.toString();
  } catch {
    return "";
  }
}
function exactAuctionDate(value: unknown) {
  const raw = clean(value);
  if (!/^20\d{2}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(raw))
    return "";
  const time = Date.parse(raw);
  return Number.isFinite(time) && time <= Date.now() + 86_400_000 ? raw : "";
}

export class CarvectorJapanExactAdapter implements CatalogSourceAdapter {
  sourceId = "carvector_japan_stat_open";
  market = "japan" as const;
  accessMode = "public_html" as const;

  async fetchPage(cursor?: string | null): Promise<CatalogFetchResult> {
    const page = Math.max(1, Number(cursor || 1) || 1);
    const url = pageUrl(page);
    const response = await fetch(url, {
      headers: { ...HEADERS, referer: `${BASE}/stat` },
      redirect: "follow",
      signal: AbortSignal.timeout(
        Math.max(
          8_000,
          Number(process.env.CATALOG_SOURCE_REQUEST_TIMEOUT_MS || 40_000),
        ),
      ),
    });
    const markup = await response.text();
    if (!response.ok)
      throw new Error(`carvector_http_${response.status}:${url}`);
    const result = parseCarvectorNgState(markup);
    const items = result.offers.map((row) => ({
      ...row,
      _carvectorListUrl: url,
    }));
    const finished = items.length === 0 || page * PAGE_SIZE >= result.total;
    return {
      items,
      nextCursor: finished ? null : String(page + 1),
      finished,
      count: items.length,
      health: {
        ok: items.length > 0,
        message: `CarVector exact auction statistics page=${page} items=${items.length} total=${result.total}`,
        checkedAt: new Date().toISOString(),
        httpStatus: response.status,
        contentType: response.headers.get("content-type") || "",
      },
    };
  }

  normalizeOffer(raw: unknown): VehicleOffer | null {
    if (!raw || typeof raw !== "object") return null;
    const row = raw as Record<string, any>;
    if (row.__typename !== "OfferAuction" || row.kind !== "AUCTION_STATS")
      return null;
    const sourceOfferId = clean(row.id).toLowerCase();
    const sourceUrl = exactSourceUrl(row);
    const make = clean(row?.make?.title),
      model = clean(row?.model?.title),
      chassis = clean(row?.chassis?.title);
    const auctionName = clean(row?.auction?.title),
      lotNumber = clean(row?.lot),
      auctionDate = exactAuctionDate(row?.auctionAt);
    const sourcePrice = positiveInteger(
      row?.finishPrice?.JPY,
      1,
      1_000_000_000,
    );
    const semanticEvidence = carvectorSpecificationEvidence(row);
    // This adapter is auction-history evidence. Keep only completed combustion
    // records with a fully specified identity and power; JPAuc remains the
    // listing/gallery owner when the two sources are joined for public cards.
    if (
      !sourceOfferId ||
      !sourceUrl ||
      !make ||
      !model ||
      !chassis ||
      !auctionName ||
      !lotNumber ||
      !auctionDate ||
      !sourcePrice
    )
      return null;
    if (
      semanticEvidence.year.status !== "exact" ||
      semanticEvidence.fuel.status !== "exact" ||
      semanticEvidence.powertrainKind.value !== "combustion" ||
      semanticEvidence.engineCc.status !== "exact" ||
      semanticEvidence.powerHp.status !== "exact" ||
      semanticEvidence.powerKw.status !== "exact"
    )
      return null;
    const now = new Date().toISOString();
    const modification = clean(row?.modification?.title);
    const title = [make, model, modification].filter(Boolean).join(" ");
    return {
      id: stableOfferId(this.sourceId, sourceOfferId),
      sourceId: this.sourceId,
      sourceOfferId,
      market: this.market,
      offerType: "auction",
      status: "sold",
      catalogKind: "auction_result",
      auctionResult: "sold",
      auctionPriceKind: "published_result",
      sourceTitle: title,
      make,
      model,
      generation: chassis,
      trim: modification || undefined,
      year: Number(semanticEvidence.year.value),
      mileageKm: positiveInteger(row?.mileage, 1, 5_000_000),
      engineCc: Number(semanticEvidence.engineCc.value),
      engineType: clean(row?.fuel?.title) || undefined,
      fuel: semanticEvidence.fuel.value,
      powertrainKind: "combustion",
      transmission:
        clean(row?.transmission?.title || row?.transmissionType?.title) ||
        undefined,
      color: clean(row?.color?.title) || undefined,
      powerHp: Number(semanticEvidence.powerHp.value),
      powerKw: Number(semanticEvidence.powerKw.value),
      icePowerKw: Number(semanticEvidence.powerKw.value),
      utilizationPowerKw: Number(semanticEvidence.powerKw.value),
      powerDataConfidence: "source_exact",
      powerDataSource: sourceUrl,
      auctionName,
      auctionDate,
      lotNumber,
      auctionGrade: clean(row?.rate?.title) || undefined,
      sourcePrice,
      sourceCurrency: "JPY",
      priceMode: "fixed",
      images: [],
      calculationStatus: "needs_data",
      firstSeenAt: now,
      updatedAt: now,
      operational: {
        sourceUrl,
        sourceVenueName: auctionName,
        sourcePublishedAt: auctionDate,
        exactDetail: true,
        sourceOnlyFieldsPreserved: true,
        auctionResultPriceVerified: true,
        auctionPriceKind: "published_result",
        semanticEvidence,
        raw: {
          sourceRow: row,
          chassis,
          carvectorEvidenceOnly: true,
          galleryOwner: "jpauc_japan_past_open_after_exact_identity_join",
          imagePolicy: "no_standalone_public_gallery_from_auction_statistics",
          powerFieldPolicy: "carvector_named_fuel_combustion_power_only_v1",
        },
      },
    };
  }

  async fetchImages(): Promise<CatalogImage[]> {
    // CarVector is the auction-result/specification evidence side of the exact
    // join. Publishing its row-bound thumbnails as a public gallery would mix
    // responsibilities and weaken JPAuc's same-lot image identity guarantee.
    return [];
  }

  mapStatus(): OfferStatus {
    return "sold";
  }
  async healthCheck(): Promise<SourceRunHealth> {
    try {
      const page = await this.fetchPage("1");
      return (
        page.health || {
          ok: page.items.length > 0,
          message: `CarVector items=${page.items.length}`,
          checkedAt: new Date().toISOString(),
        }
      );
    } catch (error) {
      const message = String((error as Error)?.message || error);
      return {
        ok: false,
        message,
        checkedAt: new Date().toISOString(),
        blocked: /rate_limited|captcha|forbidden/i.test(message),
      };
    }
  }
}

export const carvectorJapanCurrentSource = new CarvectorJapanExactAdapter();
