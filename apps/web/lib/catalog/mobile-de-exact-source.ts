import { canonicalSourceModelIdentity } from "./open-source-normalizer";
import {
  hasCredibleCatalogIdentity,
  isCatalogYearAllowed,
} from "./offer-quality";
import { canonicalSourceFuel } from "./powertrain-safety";
import { stableOfferId } from "./storage";
import type {
  CatalogFetchResult,
  CatalogImage,
  CatalogSourceAdapter,
  OfferStatus,
  SourceRunHealth,
  VehicleOffer,
} from "./types";

const MOBILE_BASE = "https://www.mobile.de";
const SEARCH_BASE = "https://suchen.mobile.de";
const SRP_API = `${MOBILE_BASE}/consumer/api/search/srp`;
const VIP_API = `${MOBILE_BASE}/consumer/api/search/vip`;
const MAX_SHARD_PAGES = 25;
const HEADERS = {
  accept: "application/json,text/plain,*/*",
  "accept-language": "de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7",
  "cache-control": "no-cache",
  pragma: "no-cache",
  referer: `${MOBILE_BASE}/`,
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
  "x-mobile-client": "de.mobile.consumer-webapp",
};

export type MobileDeExactRow = {
  id: string;
  sourceUrl: string;
  title: string;
  make: string;
  model: string;
  trim?: string;
  year: number;
  productionDate?: string;
  mileageKm?: number;
  engineCc?: number;
  powerKw?: number;
  powerHp?: number;
  fuel?: string;
  transmission?: string;
  drive?: string;
  bodyType?: string;
  bodyEvidence?: MobileDeBodyEvidence;
  price: number;
  currency: string;
  location?: string;
  numImages?: number;
  raw: Record<string, any>;
};

type CursorState = { shard: number; page: number };
type SearchShard = {
  yearFrom: number;
  yearTo: number;
  minPowerKw?: number;
  maxPowerKw?: number;
  label: string;
};

function clean(value: unknown) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}
function positive(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}
function integer(value: unknown) {
  const raw = clean(value).replace(/\u00a0/g, " ");
  const digits = raw.replace(/[^0-9]/g, "");
  const number = Number(digits);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}
function parsePower(value: unknown) {
  const raw = clean(value).replace(/\u00a0/g, " ");
  const kw = Number(
    raw.match(/([0-9]{1,4}(?:[.,][0-9]+)?)\s*kW/i)?.[1]?.replace(",", "."),
  );
  const hp = Number(
    raw
      .match(/([0-9]{1,4}(?:[.,][0-9]+)?)\s*(?:PS|hp)/i)?.[1]
      ?.replace(",", "."),
  );
  return {
    powerKw:
      Number.isFinite(kw) && kw > 0 ? Math.round(kw * 10) / 10 : undefined,
    powerHp:
      Number.isFinite(hp) && hp > 0
        ? Math.round(hp * 10) / 10
        : Number.isFinite(kw) && kw > 0
          ? Math.round(kw * 1.3596216173 * 10) / 10
          : undefined,
  };
}

type MobileDeEvidenceStatus = "exact" | "ambiguous" | "conflict" | "missing";

type MobileDeMetricEvidence = {
  value?: number;
  rawValues: number[];
  status: MobileDeEvidenceStatus;
};

type MobileDeFuelEvidence = {
  value?: string;
  rawValues: string[];
  status: MobileDeEvidenceStatus;
};

type MobileDeBodyEvidence = {
  value?: string;
  rawValues: string[];
  status: MobileDeEvidenceStatus;
};

function metricEvidence(
  listing: unknown,
  detail: unknown,
  minimum: number,
  maximum: number,
  tolerance = 0,
): MobileDeMetricEvidence {
  const rawValues = [listing, detail]
    .filter(
      (value) =>
        value !== undefined && value !== null && String(value).trim() !== "",
    )
    .map(Number);
  if (!rawValues.length) return { rawValues, status: "missing" };
  if (
    rawValues.some(
      (value) => !Number.isFinite(value) || value < minimum || value > maximum,
    )
  )
    return { rawValues, status: "ambiguous" };
  if (Math.max(...rawValues) - Math.min(...rawValues) > tolerance)
    return { rawValues, status: "conflict" };
  return {
    value: detail ? Number(detail) : Number(listing),
    rawValues,
    status: "exact",
  };
}

function fuelEvidence(listing: unknown, detail: unknown): MobileDeFuelEvidence {
  const rawValues = [...new Set([listing, detail].map(clean).filter(Boolean))];
  if (!rawValues.length) return { rawValues, status: "missing" };
  const values = rawValues.map(canonicalSourceFuel);
  if (values.some((value) => !value)) return { rawValues, status: "ambiguous" };
  const canonical = [...new Set(values as string[])];
  if (canonical.length !== 1) return { rawValues, status: "conflict" };
  return { value: canonical[0], rawValues, status: "exact" };
}

function exactMobileDeBody(value: unknown) {
  const normalized = clean(value).toLowerCase();
  if (/^(?:cabrio|cabriolet|roadster)$/.test(normalized)) return "convertible";
  if (/^(?:coupé|coupe)$/.test(normalized)) return "coupe";
  if (/^(?:kombi|estate|station wagon)$/.test(normalized)) return "wagon";
  if (/^(?:suv|crossover)$/.test(normalized)) return "suv";
  if (/^(?:geländewagen|offroad)$/.test(normalized)) return "offroad";
  if (/^(?:pickup|pick-up)$/.test(normalized)) return "pickup";
  if (/^(?:minivan|mpv)$/.test(normalized)) return "minivan";
  if (normalized === "van") return "van";
  if (normalized === "hatchback") return "hatchback";
  if (/^(?:sedan|saloon)$/.test(normalized)) return "sedan";
  // mobile.de's German "Limousine" bucket is not a reliable sedan shape.
  // Sellers use it for hatchbacks such as Abarth 595, Polo, Leon and i20.
  return undefined;
}

export function mobileDeBodyEvidence(values: unknown[]): MobileDeBodyEvidence {
  const rawValues = [...new Set(values.map(clean).filter(Boolean))];
  if (!rawValues.length) return { rawValues, status: "missing" };
  const mapped = rawValues.map(exactMobileDeBody);
  if (mapped.some((value) => !value)) return { rawValues, status: "ambiguous" };
  const canonical = [...new Set(mapped as string[])];
  if (canonical.length !== 1) return { rawValues, status: "conflict" };
  return { value: canonical[0], rawValues, status: "exact" };
}

function powertrainKindForFuel(fuel: string | undefined) {
  if (fuel === "electric") return "electric" as const;
  if (fuel === "hybrid") return "other_hybrid" as const;
  if (fuel) return "combustion" as const;
  return "unknown" as const;
}

export function mobileDeSpecificationEvidence(args: {
  listingEngineCc?: number;
  detailEngineCc?: number;
  listingPowerHp?: number;
  detailPowerHp?: number;
  listingFuel?: string;
  detailFuel?: string;
}) {
  return {
    fuel: fuelEvidence(args.listingFuel, args.detailFuel),
    engineCc: metricEvidence(
      args.listingEngineCc,
      args.detailEngineCc,
      300,
      10_000,
    ),
    powerHp: metricEvidence(
      args.listingPowerHp,
      args.detailPowerHp,
      20,
      2_500,
      1,
    ),
  };
}
function parseRegistration(value: unknown) {
  const raw = clean(value);
  const match =
    raw.match(/\b(0?[1-9]|1[0-2])[/.]((?:19|20)\d{2})\b/) ||
    raw.match(/\b((?:19|20)\d{2})\b/);
  if (!match) return { year: 0, productionDate: undefined };
  if (match.length >= 3)
    return {
      year: Number(match[2]),
      productionDate: `${match[2]}-${String(Number(match[1])).padStart(2, "0")}`,
    };
  return { year: Number(match[1]), productionDate: undefined };
}
function absoluteListingUrl(value: unknown) {
  const raw = clean(value);
  if (!raw) return "";
  try {
    return new URL(raw, SEARCH_BASE).toString();
  } catch {
    return "";
  }
}
function image(url: string): CatalogImage {
  return {
    id: "",
    url,
    objectKey: "",
    checksum: "",
    size: 0,
    mimeType: "image/jpeg",
  };
}
function parseCursor(cursor?: string | null): CursorState {
  if (!cursor) return { shard: 0, page: 1 };
  try {
    const parsed = JSON.parse(cursor);
    const shard = Number(parsed?.shard);
    const page = Number(parsed?.page);
    return {
      shard: Number.isInteger(shard) && shard >= 0 ? shard : 0,
      page: Number.isInteger(page) && page >= 1 ? page : 1,
    };
  } catch {
    const page = Number(cursor);
    return { shard: 0, page: Number.isInteger(page) && page >= 1 ? page : 1 };
  }
}
function searchShards(): SearchShard[] {
  const currentYear = new Date().getUTCFullYear();
  const allowedYears = Array.from(
    { length: Math.max(1, currentYear - 2020 + 1) },
    (_, index) => currentYear - index,
  ).filter((year) => year >= 2020);
  const powerBands = [
    { minPowerKw: 1, maxPowerKw: 85, label: "power_001_085" },
    { minPowerKw: 86, maxPowerKw: 118, label: "power_086_118" },
    { minPowerKw: 119, maxPowerKw: 160, label: "power_119_160" },
    { minPowerKw: 161, maxPowerKw: 220, label: "power_161_220" },
    { minPowerKw: 221, label: "power_221_plus" },
  ];
  return allowedYears.flatMap((year) =>
    powerBands.map((band) => ({
      yearFrom: year,
      yearTo: year,
      ...band,
      label: `${band.label}_${year}`,
    })),
  );
}
function classicSearchUrl(shard: SearchShard, page: number) {
  const url = new URL("/fahrzeuge/search.html", SEARCH_BASE);
  url.searchParams.set("dam", "false");
  url.searchParams.set("isSearchRequest", "true");
  url.searchParams.set("vc", "Car");
  url.searchParams.set("fr", `${shard.yearFrom}:${shard.yearTo}`);
  if (shard.minPowerKw || shard.maxPowerKw)
    url.searchParams.set(
      "pw",
      `${shard.minPowerKw || ""}:${shard.maxPowerKw || ""}`,
    );
  url.searchParams.set("pageNumber", String(page));
  return url.toString();
}
async function getJson(url: string) {
  const response = await fetch(url, {
    headers: HEADERS,
    redirect: "follow",
    signal: AbortSignal.timeout(
      Math.max(
        8_000,
        Number(process.env.CATALOG_SOURCE_REQUEST_TIMEOUT_MS || 30_000),
      ),
    ),
  });
  const body = await response.text();
  if (!response.ok)
    throw new Error(`mobile_de_bff_http_${response.status}:${url}`);
  let json: any;
  try {
    json = JSON.parse(body);
  } catch {
    throw new Error(
      `mobile_de_bff_non_json_${response.status}_bytes_${body.length}`,
    );
  }
  if (json?.error)
    throw new Error(
      `mobile_de_bff_error:${clean(json.error?.errors?.[0]?.reason || json.error?.message || "unknown")}`,
    );
  return { response, json };
}
function rowFromItem(item: Record<string, any>): MobileDeExactRow | null {
  const id = clean(item?.id);
  const make = clean(item?.make);
  const sourceModel = clean(item?.model);
  const sourceUrl = absoluteListingUrl(item?.relativeUrl || item?.url);
  const price = positive(item?.price?.grossAmount);
  const currency = clean(item?.price?.grossCurrency || "EUR");
  const registration = parseRegistration(
    item?.attr?.fr || item?.firstRegistration,
  );
  const power = parsePower(item?.attr?.pw);
  const mileageKm = integer(item?.attr?.ml);
  const engineCc = integer(item?.attr?.cc);
  const title = clean(
    item?.title ||
      [make, sourceModel, item?.subTitle].filter(Boolean).join(" "),
  );
  const model = canonicalSourceModelIdentity(title, make, sourceModel);
  const trim = clean(item?.subTitle);
  const fuel = clean(item?.attr?.ft);
  const transmission = clean(item?.attr?.tr);
  const rawBodyType = clean(item?.attr?.c || item?.category);
  const bodyEvidence = mobileDeBodyEvidence([rawBodyType]);
  const bodyType =
    bodyEvidence.status === "exact" ? bodyEvidence.value : undefined;
  const location = clean(
    item?.contactInfo?.location ||
      [item?.attr?.z, item?.attr?.loc].filter(Boolean).join(" "),
  );
  const vc = clean(item?.vc || item?.segment);
  if (
    !id ||
    !make ||
    !model ||
    !sourceUrl.includes("mobile.de/") ||
    !price ||
    !currency ||
    !registration.year
  )
    return null;
  if (
    !isCatalogYearAllowed(registration.year, "europe") ||
    !hasCredibleCatalogIdentity({ make, model })
  )
    return null;
  if (vc && !/^car$/i.test(vc)) return null;
  return {
    id,
    sourceUrl,
    title,
    make,
    model,
    trim: trim || undefined,
    year: registration.year,
    productionDate: registration.productionDate,
    mileageKm,
    engineCc,
    ...power,
    fuel: fuel || undefined,
    transmission: transmission || undefined,
    bodyType,
    bodyEvidence,
    price,
    currency,
    location: location || undefined,
    numImages: positive(item?.numImages),
    raw: item,
  };
}
function attributeMap(ad: any) {
  const values = new Map<string, string>();
  for (const row of Array.isArray(ad?.attributes) ? ad.attributes : []) {
    const tag = clean(row?.tag);
    const value = Array.isArray(row?.value)
      ? row.value.map(clean).filter(Boolean).join(" / ")
      : clean(row?.value);
    if (tag && value) values.set(tag, value);
  }
  return values;
}
function largestGalleryUrl(value: any) {
  const srcSet = clean(value?.srcSet);
  const entries = srcSet
    .split(",")
    .map((part) => {
      const pieces = part.trim().split(/\s+/);
      const width = Number(
        pieces[1]?.match(/(\d+)w/i)?.[1] ||
          pieces[0]?.match(/rule=mo-(\d+)/i)?.[1] ||
          0,
      );
      return { url: pieces[0] || "", width };
    })
    .filter((entry) =>
      /^https?:\/\/img\.classistatic\.de\/api\/v1\/mo-prod\/images\//i.test(
        entry.url,
      ),
    );
  entries.sort((left, right) => right.width - left.width);
  const direct = entries[0]?.url || clean(value?.src);
  if (
    !/^https?:\/\/img\.classistatic\.de\/api\/v1\/mo-prod\/images\//i.test(
      direct,
    )
  )
    return "";
  return direct;
}

export class MobileDeExactAdapter implements CatalogSourceAdapter {
  sourceId = "mobile_de_open";
  market = "europe" as const;
  accessMode = "public_json" as const;

  async fetchPage(cursor?: string | null): Promise<CatalogFetchResult> {
    const shards = searchShards();
    const state = parseCursor(cursor);
    if (state.shard >= shards.length)
      return { items: [], nextCursor: null, finished: true, count: 0 };
    const shard = shards[state.shard];
    const classic = classicSearchUrl(shard, state.page);
    const api = `${SRP_API}?url=${encodeURIComponent(classic)}`;
    const { response, json } = await getJson(api);
    const result = json?.searchResults || {};
    const items = (Array.isArray(result?.items) ? result.items : [])
      .map(rowFromItem)
      .filter((row: MobileDeExactRow | null): row is MobileDeExactRow =>
        Boolean(row),
      );
    const reportedPages = Math.max(1, Number(result?.numPages || 1));
    const shardPageLimit = Math.min(MAX_SHARD_PAGES, reportedPages);
    const nextState =
      state.page < shardPageLimit
        ? { shard: state.shard, page: state.page + 1 }
        : state.shard + 1 < shards.length
          ? { shard: state.shard + 1, page: 1 }
          : null;
    return {
      items,
      nextCursor: nextState ? JSON.stringify(nextState) : null,
      finished: !nextState,
      count: Number(result?.numResultsTotal || items.length),
      health: {
        ok: response.ok && items.length > 0,
        message: `mobile.de BFF ${shard.label} page=${state.page}/${shardPageLimit} parsed=${items.length} total=${Number(result?.numResultsTotal || 0)}`,
        checkedAt: new Date().toISOString(),
        httpStatus: response.status,
        contentType: response.headers.get("content-type") || "",
      },
    };
  }

  normalizeOffer(raw: unknown): VehicleOffer | null {
    const row = raw as MobileDeExactRow;
    if (
      !row?.id ||
      !row.make ||
      !row.model ||
      !row.year ||
      !row.price ||
      !row.sourceUrl
    )
      return null;
    if (
      !isCatalogYearAllowed(row.year, "europe") ||
      !hasCredibleCatalogIdentity(row)
    )
      return null;
    const now = new Date().toISOString();
    const evidence = mobileDeSpecificationEvidence({
      listingEngineCc: row.engineCc,
      listingPowerHp: row.powerHp,
      listingFuel: row.fuel,
    });
    const bodyEvidence =
      row.bodyEvidence || mobileDeBodyEvidence([row.bodyType]);
    const exactFuel =
      evidence.fuel.status === "exact" ? evidence.fuel.value : undefined;
    const exactEngineCc =
      evidence.engineCc.status === "exact"
        ? evidence.engineCc.value
        : undefined;
    const exactPowerHp =
      evidence.powerHp.status === "exact" ? evidence.powerHp.value : undefined;
    return {
      id: stableOfferId(this.sourceId, row.id),
      sourceId: this.sourceId,
      sourceOfferId: row.id,
      market: "europe",
      offerType: "fixed",
      status: "active",
      sourceTitle: row.title,
      make: row.make,
      model: row.model,
      trim: row.trim,
      year: row.year,
      productionDate: row.productionDate,
      mileageKm: row.mileageKm,
      engineCc: exactFuel === "electric" ? undefined : exactEngineCc,
      powerKw: exactPowerHp ? row.powerKw : undefined,
      powerHp: exactPowerHp,
      fuel: exactFuel,
      powertrainKind: powertrainKindForFuel(exactFuel),
      transmission: row.transmission,
      bodyType:
        bodyEvidence.status === "exact" ? bodyEvidence.value : undefined,
      powerDataConfidence: exactPowerHp ? "source_exact" : undefined,
      powerDataSource: exactPowerHp ? "mobile.de consumer SRP" : undefined,
      sourcePrice: row.price,
      sourceCurrency: row.currency,
      priceMode: "fixed",
      images: [],
      totalRub: null,
      calculationStatus: "needs_data",
      firstSeenAt: now,
      updatedAt: now,
      operational: {
        sourceUrl: row.sourceUrl,
        sourceVenueName: row.location || "mobile.de Europe",
        sourceTitle: row.title,
        exactFields: true,
        exactDetail: false,
        exactPhotos: false,
        galleryVerified: false,
        galleryImageCount: 0,
        gallerySafetyMode: "mobile_consumer_bff_pending_detail_v1",
        galleryStoredAs: "json_urls",
        semanticEvidence: {
          fuel: {
            source: "mobile.de consumer SRP attributes",
            ...evidence.fuel,
          },
          engineCc: {
            source: "mobile.de consumer SRP attributes",
            ...evidence.engineCc,
          },
          powerHp: {
            source: "mobile.de consumer SRP attributes",
            ...evidence.powerHp,
          },
          bodyType: {
            source: "mobile.de consumer SRP category",
            ...bodyEvidence,
          },
        },
        raw: { parsed: row, srp: row.raw },
      },
    } as VehicleOffer;
  }

  async fetchImages(offer: VehicleOffer): Promise<CatalogImage[]> {
    const sourceUrl = clean(offer.operational?.sourceUrl);
    if (!sourceUrl || !sourceUrl.includes("mobile.de/")) return [];
    const { json } = await getJson(
      `${VIP_API}?url=${encodeURIComponent(sourceUrl)}`,
    );
    const ad = json?.ad;
    if (!ad || clean(ad?.id) !== clean(offer.sourceOfferId))
      throw new Error(`mobile_de_vip_identity_mismatch:${offer.sourceOfferId}`);
    if (positive(ad?.price?.grossAmount) !== positive(offer.sourcePrice))
      throw new Error(`mobile_de_vip_price_mismatch:${offer.sourceOfferId}`);
    const attrs = attributeMap(ad);
    const power = parsePower(attrs.get("power"));
    const previousRaw = (
      offer.operational?.raw && typeof offer.operational.raw === "object"
        ? offer.operational.raw
        : {}
    ) as Record<string, any>;
    const parsedListing = previousRaw.parsed as MobileDeExactRow | undefined;
    const previousEvidence = (offer.operational as any)?.semanticEvidence || {};
    const listingEngineCc =
      parsedListing?.engineCc ??
      (previousEvidence?.engineCc?.status === "exact"
        ? offer.engineCc
        : undefined);
    const listingPowerHp =
      parsedListing?.powerHp ??
      (previousEvidence?.powerHp?.status === "exact"
        ? offer.powerHp
        : undefined);
    const listingPowerKw =
      parsedListing?.powerKw ??
      (previousEvidence?.powerHp?.status === "exact"
        ? offer.powerKw
        : undefined);
    const listingFuel =
      parsedListing?.fuel ??
      (previousEvidence?.fuel?.status === "exact" ? offer.fuel : undefined);
    const detailEngineCc = integer(attrs.get("cubicCapacity"));
    const detailFuel = clean(attrs.get("fuel")) || undefined;
    const evidence = mobileDeSpecificationEvidence({
      listingEngineCc,
      detailEngineCc,
      listingPowerHp,
      detailPowerHp: power.powerHp,
      listingFuel,
      detailFuel,
    });
    const bodyEvidence = mobileDeBodyEvidence([
      parsedListing?.raw?.attr?.c || parsedListing?.raw?.category,
      attrs.get("category") || ad?.category,
    ]);
    const registration = parseRegistration(attrs.get("firstRegistration"));
    const detailMake = clean(ad?.makeKey) || offer.make;
    const detailTitle = clean(ad?.title) || offer.sourceTitle;
    const detailModel = canonicalSourceModelIdentity(
      detailTitle,
      detailMake,
      clean(ad?.modelKey) || offer.model,
    );
    if (!hasCredibleCatalogIdentity({ make: detailMake, model: detailModel })) {
      throw new Error(
        `mobile_de_vip_placeholder_identity:${offer.sourceOfferId}`,
      );
    }
    if (
      registration.year &&
      !isCatalogYearAllowed(registration.year, "europe")
    ) {
      throw new Error(
        `mobile_de_vip_year_out_of_policy:${offer.sourceOfferId}:${registration.year}`,
      );
    }
    offer.make = detailMake;
    offer.model = detailModel;
    offer.sourceTitle = detailTitle;
    offer.trim = clean(ad?.subTitle) || offer.trim;
    offer.year = registration.year || offer.year;
    offer.productionDate = registration.productionDate || offer.productionDate;
    offer.mileageKm = integer(attrs.get("mileage")) || offer.mileageKm;
    offer.fuel =
      evidence.fuel.status === "exact" ? evidence.fuel.value : undefined;
    offer.powertrainKind = powertrainKindForFuel(offer.fuel);
    offer.engineCc =
      offer.fuel === "electric"
        ? undefined
        : evidence.engineCc.status === "exact"
          ? evidence.engineCc.value
          : undefined;
    offer.powerHp =
      evidence.powerHp.status === "exact" ? evidence.powerHp.value : undefined;
    offer.powerKw =
      evidence.powerHp.status === "exact"
        ? power.powerKw || listingPowerKw
        : undefined;
    offer.transmission = clean(attrs.get("transmission")) || offer.transmission;
    offer.bodyType =
      bodyEvidence.status === "exact" ? bodyEvidence.value : undefined;
    if (
      evidence.powerHp.status === "exact" &&
      (offer.powerKw || offer.powerHp)
    ) {
      offer.powerDataConfidence = "source_exact";
      offer.powerDataSource = "mobile.de consumer VIP attributes";
    } else {
      offer.powerDataConfidence = undefined;
      offer.powerDataSource = undefined;
    }
    if (
      [
        evidence.fuel.status,
        evidence.engineCc.status,
        evidence.powerHp.status,
      ].some((status) => status === "ambiguous" || status === "conflict")
    ) {
      offer.calculationStatus = "needs_data";
    }
    const urls = [
      ...new Set(
        (Array.isArray(ad?.galleryImages) ? ad.galleryImages : [])
          .map(largestGalleryUrl)
          .filter(Boolean),
      ),
    ].slice(
      0,
      Math.min(
        30,
        Math.max(5, Number(process.env.CATALOG_MAX_IMAGES_PER_OFFER || 30)),
      ),
    );
    const verified =
      urls.length >=
      Math.max(
        5,
        Number(process.env.CATALOG_REBUILD_MIN_IMAGES_PER_OFFER || 5),
      );
    offer.operational = {
      ...(offer.operational || {}),
      exactDetail: true,
      exactFields: true,
      exactPhotos: verified,
      photoIdentityVerified: verified,
      galleryVerified: verified,
      galleryImageCount: urls.length,
      gallerySafetyMode: "mobile_consumer_bff_exact_v1",
      galleryStoredAs: "json_urls",
      semanticEvidence: {
        ...previousEvidence,
        fuel: {
          source: "mobile.de consumer SRP/VIP attributes",
          ...evidence.fuel,
        },
        engineCc: {
          source: "mobile.de consumer SRP/VIP attributes",
          ...evidence.engineCc,
        },
        powerHp: {
          source: "mobile.de consumer SRP/VIP attributes",
          ...evidence.powerHp,
        },
        bodyType: {
          source: "mobile.de consumer SRP/VIP category",
          ...bodyEvidence,
        },
      },
      raw: {
        ...previousRaw,
        vip: ad,
        images: urls,
        listingBoundImages: verified,
        photoIdentityVerified: verified,
        detailIdentityVerified: true,
      },
    };
    return urls.map(image);
  }

  mapStatus(): OfferStatus {
    return "active";
  }
  async healthCheck(): Promise<SourceRunHealth> {
    try {
      const page = await this.fetchPage(null);
      return (
        page.health || {
          ok: page.items.length > 0,
          message: `mobile.de BFF parsed=${page.items.length}`,
          checkedAt: new Date().toISOString(),
        }
      );
    } catch (error) {
      return {
        ok: false,
        message: clean((error as Error)?.message || error),
        checkedAt: new Date().toISOString(),
      };
    }
  }
}

export const mobileDeExactSource = new MobileDeExactAdapter();
