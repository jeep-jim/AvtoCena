import { cacheImageFromUrl, stableOfferId } from "./storage";
import { normalizeVehicleOfferSpecs } from "./spec-normalization";
import { canonicalSourceFuel } from "./powertrain-safety";
import type { CatalogFetchResult, CatalogImage, CatalogSourceAdapter, OfferStatus, VehicleOffer } from "./types";

const HEADERS = {
  // Exact request fingerprint verified HTTP 200 from the deployed Yandex runtime.
  // Adding cache/navigation/referer headers changes MyAuto's Cloudflare decision to 403.
  accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9,ka;q=0.8",
  "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/150 Safari/537.36",
};
const DETAIL_RE = /\/en\/pr\/(\d+)\/[^"'?#\s<>]+/i;
const BAD_IMAGE_RE = /logo|icon|avatar|qrcode|placeholder|banner|sprite|tracking|pixel|favicon|appstore|googleplay|no[-_ ]?(?:photo|image)/i;
const COMMERCIAL_RE = /\b(?:truck|bus|minibus|commercial|cargo|tractor|forklift|excavator|agricultural|scooter|motorcycle|quad\s*bike|sprinter|transit|crafter|ducato|boxer|jumper)\b/i;
const MYAUTO_PRODUCT_API = "https://api2.myauto.ge/en/products";
const KNOWN_MAKES = [
  "Mercedes-Benz", "Land Rover", "Range Rover", "Rolls-Royce", "Alfa Romeo", "Aston Martin", "Great Wall", "Li Auto",
  "Toyota", "Lexus", "Nissan", "Infiniti", "Honda", "Acura", "Mazda", "Mitsubishi", "Subaru", "Suzuki", "Daihatsu", "Isuzu",
  "Hyundai", "Genesis", "Kia", "KGM", "SsangYong", "BMW", "Audi", "Volkswagen", "Volvo", "Porsche", "Ford", "Chevrolet", "Cadillac",
  "Jeep", "Dodge", "Renault", "Peugeot", "Citroen", "Skoda", "SEAT", "MINI", "Fiat", "Opel", "Tesla", "BYD", "Geely", "Changan",
  "Chery", "GAC", "Haval", "Zeekr", "Nio", "XPeng", "Jetour", "Denza", "Hongqi", "Tank", "Voyah", "Aito", "Leapmotor", "Arcfox", "Neta",
].sort((left, right) => right.length - left.length);

export type MyAutoListRow = {
  id: string;
  detailUrl: string;
  title: string;
  make: string;
  model: string;
  year: number;
  price: number;
  currency: "GEL";
  fuel?: string;
  bodyType?: string;
  location?: string;
  images: string[];
};

export type MyAutoListingImageIdentity = {
  id: string;
  photo: string;
  size: "thumbs" | "large";
  index: number;
  version: number;
};

export type MyAutoProductSnapshot = {
  galleryUrls: string[];
  engineCc?: number;
  powerHp?: number;
  semanticEvidence: {
    engineCc: MyAutoMetricEvidence;
    powerHp: MyAutoMetricEvidence;
  };
};

type MyAutoEvidenceStatus = "exact" | "ambiguous" | "conflict" | "missing";
type MyAutoMetricEvidence = { value?: number; rawValues: string[]; status: MyAutoEvidenceStatus };
type MyAutoFuelEvidence = { value?: string; rawValues: string[]; status: MyAutoEvidenceStatus };

function exactMetricEvidence(values: unknown[], minimum: number, maximum: number): MyAutoMetricEvidence {
  const rawValues = [...new Set(values.map((value) => String(value ?? "").trim()).filter(Boolean))];
  if (!rawValues.length) return { rawValues, status: "missing" };
  const parsed = rawValues.map(Number);
  if (parsed.some((value) => !Number.isInteger(value) || value < minimum || value > maximum)) {
    return { rawValues, status: "ambiguous" };
  }
  const exact = [...new Set(parsed)];
  if (exact.length !== 1) return { rawValues, status: "conflict" };
  return { value: exact[0], rawValues, status: "exact" };
}

function myAutoFuelEvidence(value: unknown): MyAutoFuelEvidence {
  const raw = String(value ?? "").trim();
  const rawValues = raw ? [raw] : [];
  if (!raw) return { rawValues, status: "missing" };
  const canonical = canonicalSourceFuel(raw);
  return canonical
    ? { value: canonical, rawValues, status: "exact" }
    : { rawValues, status: "ambiguous" };
}

function powertrainKindForFuel(fuel: string | undefined) {
  if (fuel === "electric") return "electric" as const;
  if (fuel === "hybrid") return "other_hybrid" as const;
  if (fuel) return "combustion" as const;
  return "unknown" as const;
}

export function myAutoListingSpecificationEvidence(row: Pick<MyAutoListRow, "year" | "fuel">) {
  return {
    year: exactMetricEvidence([row.year], 1900, new Date().getUTCFullYear() + 1),
    fuel: myAutoFuelEvidence(row.fuel),
    engineCc: exactMetricEvidence([], 300, 10_000),
    powerHp: exactMetricEvidence([], 20, 2_500),
  };
}

export function parseMyAutoListingImageUrl(value: string, expectedId: string): MyAutoListingImageIdentity | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "static.tnet.ge") return null;
    const match = url.pathname.match(/^\/myauto\/photos\/(\d+(?:\/\d+){4})\/(thumbs|large)\/(\d+)_([1-9]\d*)\.jpg$/i);
    const versionText = url.searchParams.get("v") || "";
    if (!match || match[3] !== String(expectedId) || !/^\d+$/.test(versionText)) return null;
    const index = Number(match[4]);
    const version = Number(versionText);
    if (!Number.isSafeInteger(index) || index < 1 || !Number.isSafeInteger(version) || version < 0) return null;
    return { id: match[3], photo: match[1], size: match[2].toLowerCase() as "thumbs" | "large", index, version };
  } catch {
    return null;
  }
}

export function buildMyAutoLargePhotoUrls(input: { id: unknown; photo: unknown; count: unknown; version: unknown }) {
  const id = String(input.id ?? "");
  const photo = String(input.photo ?? "");
  const countText = String(input.count ?? "");
  const versionText = String(input.version ?? "");
  if (!/^\d{5,}$/.test(id) || !/^\d+(?:\/\d+){4}$/.test(photo) || !/^\d+$/.test(countText) || !/^\d+$/.test(versionText)) return [];
  const count = Math.min(30, Number(countText));
  const version = Number(versionText);
  if (!Number.isSafeInteger(count) || count < 1 || !Number.isSafeInteger(version) || version < 0) return [];
  return Array.from({ length: count }, (_, offset) =>
    `https://static.tnet.ge/myauto/photos/${photo}/large/${id}_${offset + 1}.jpg?v=${version}`);
}

export function myAutoProductSnapshotFromInfo(info: Record<string, unknown>, expectedId: string, expectedPhoto?: string): MyAutoProductSnapshot | null {
  const id = String(info?.car_id ?? "");
  const photo = String(info?.photo ?? "");
  if (!/^\d{5,}$/.test(expectedId) || id !== expectedId) return null;
  if (expectedPhoto && photo !== expectedPhoto) return null;
  const galleryUrls = buildMyAutoLargePhotoUrls({ id, photo, count: info.pic_number, version: info.photo_ver });
  if (!galleryUrls.length) return null;
  const engineCc = exactMetricEvidence([info.engine_volume, info.engine_cc], 300, 10_000);
  const powerHp = exactMetricEvidence([info.power_hp, info.horsepower], 20, 2_500);
  return {
    galleryUrls,
    engineCc: engineCc.status === "exact" ? engineCc.value : undefined,
    powerHp: powerHp.status === "exact" ? powerHp.value : undefined,
    semanticEvidence: { engineCc, powerHp },
  };
}

async function fetchMyAutoProductSnapshot(id: string, expectedPhoto?: string) {
  if (!/^\d{5,}$/.test(id)) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.CATALOG_SOURCE_TIMEOUT_MS || 15_000));
  try {
    const response = await fetch(`${MYAUTO_PRODUCT_API}/${id}`, {
      headers: HEADERS,
      redirect: "follow",
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const payload = await response.json().catch(() => null) as any;
    const info = payload?.data?.info;
    if (!info || typeof info !== "object") return null;
    return myAutoProductSnapshotFromInfo(info as Record<string, unknown>, id, expectedPhoto);
  } finally {
    clearTimeout(timeout);
  }
}

function decodeHtml(value: string) {
  return String(value || "")
    .replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&#x2F;/gi, "/")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}
function plainText(value: string) {
  return decodeHtml(value).replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/[\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim();
}
function absoluteUrl(value: string, base: string) {
  if (!value || /^(?:data:|javascript:|mailto:|tel:)/i.test(value)) return "";
  try { return new URL(value.replace(/\\\//g, "/").replace(/&amp;/gi, "&"), base).toString(); } catch { return ""; }
}
function imageUrls(markup: string, base: string) {
  const values: string[] = [];
  for (const match of markup.matchAll(/<(?:img|source)[^>]+(?:data-original|data-lazy-src|data-src|src|content)\s*=\s*["']([^"']+)["']/gi)) values.push(match[1]);
  for (const match of markup.matchAll(/(?:data-srcset|srcset)\s*=\s*["']([^"']+)["']/gi)) match[1].split(",").forEach((item) => values.push(item.trim().split(/\s+/)[0]));
  for (const match of markup.matchAll(/https?:\\?\/\\?\/[^"'\\\s<>]+?\.(?:jpe?g|png|webp|avif)(?:\?[^"'\\\s<>]*)?/gi)) values.push(match[0].replace(/\\\//g, "/"));
  return [...new Set(values.map((value) => absoluteUrl(value, base)).filter((url) => /^https?:/i.test(url) && !BAD_IMAGE_RE.test(url)))];
}
function deriveMakeModel(title: string) {
  const cleaned = plainText(title).replace(/\b(?:19|20)\d{2}\b.*$/, "").trim();
  const lower = cleaned.toLocaleLowerCase("en-US");
  const make = KNOWN_MAKES.find((candidate) => lower === candidate.toLocaleLowerCase("en-US") || lower.startsWith(`${candidate.toLocaleLowerCase("en-US")} `));
  if (!make) return { make: "", model: "" };
  return { make, model: cleaned.slice(make.length).replace(/^[\s\-–—|]+/, "").trim() };
}
function integer(value: string | undefined) {
  const parsed = Number(String(value || "").replace(/[^0-9]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
function meaningfulAnchorTitle(inner: string) {
  const value = plainText(inner);
  return value.length >= 3 && value.length <= 100 && !/^(?:Super VIP|VIP|Image|Add)$/i.test(value) ? value : "";
}
function isDetailHref(value: string) {
  try { return DETAIL_RE.test(new URL(value).pathname); } catch { return false; }
}
function isSaleDetailHref(value: string) {
  try {
    const path = new URL(value).pathname;
    return isDetailHref(value) && !/\/for-rent(?:-|\/)/i.test(path);
  } catch { return false; }
}

export function buildMyAutoListUrls(page: number) {
  const safePage = Math.max(1, Math.floor(Number(page) || 1));
  const urls = safePage === 1
    ? [
      "https://www.myauto.ge/en/main",
      "https://myauto.ge/en/main",
      "https://www.myauto.ge/en/main?page=1",
      "https://myauto.ge/en/main?page=1",
    ]
    : [
      `https://www.myauto.ge/en/main?page=${safePage}`,
      `https://myauto.ge/en/main?page=${safePage}`,
    ];
  return [...new Set(urls)];
}

export function parseMyAutoListingMarkup(markup: string, pageUrl: string): MyAutoListRow[] {
  const anchors = [...markup.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
    .map((match) => ({ href: absoluteUrl(match[1], pageUrl), inner: match[2], index: match.index || 0 }))
    .filter((row) => isDetailHref(row.href));
  const grouped = new Map<string, { href: string; index: number; titles: string[] }>();
  for (const anchor of anchors) {
    const id = anchor.href.match(DETAIL_RE)?.[1];
    if (!id) continue;
    const current = grouped.get(id) || { href: anchor.href, index: anchor.index, titles: [] };
    current.index = Math.min(current.index, anchor.index);
    const title = meaningfulAnchorTitle(anchor.inner);
    if (title) current.titles.push(title);
    grouped.set(id, current);
  }
  const entries = [...grouped.entries()].sort((left, right) => left[1].index - right[1].index);
  const rows: MyAutoListRow[] = [];
  for (let index = 0; index < entries.length; index++) {
    const [id, entry] = entries[index];
    if (!isSaleDetailHref(entry.href)) continue;
    const nextIndex = entries[index + 1]?.[1].index || Math.min(markup.length, entry.index + 12_000);
    const card = markup.slice(entry.index, Math.max(entry.index + 1, nextIndex));
    const text = plainText(card);
    const title = [...entry.titles].sort((left, right) => right.length - left.length)[0] || "";
    const { make, model } = deriveMakeModel(title);
    const year = Number(text.match(/\b(19\d{2}|20\d{2})\s*(?:წ|year)?\b/i)?.[1]);
    if (!year || year < 2020) continue;
    const numberTokens = [...text.matchAll(/(?:^|\s)([0-9]{1,3}(?:[ ,][0-9]{3})+|[0-9]{4,6})(?=\s|$)/g)]
      .map((match) => integer(match[1]))
      .filter((value): value is number => Boolean(value && value !== year && value > 2_999 && value < 2_000_000));
    const price = numberTokens.at(-1);
    const bodyType = text.match(/\b(Sedan|Hatchback|Jeep|Coupe|Cabriolet|Minivan|Universal|Wagon)\b/i)?.[1];
    const fuel = text.match(/\b(Petrol|Diesel|Electric|Hybrid|Plug-in Hybrid|LPG|CNG|Hydrogen)\b/i)?.[1];
    if (!make || !model || !price || COMMERCIAL_RE.test(`${title} ${text.slice(0, 400)}`)) continue;
    rows.push({
      id,
      detailUrl: entry.href,
      title,
      make,
      model,
      year,
      price,
      currency: "GEL",
      fuel,
      bodyType,
      location: text.match(/\b(Tbilisi|Batumi|Rustavi(?: Car Market)?|Kutaisi|Poti|Gori|Kobuleti|Telavi|Georgia)\b/i)?.[1],
      images: imageUrls(card, pageUrl).filter((url) => Boolean(parseMyAutoListingImageUrl(url, id))).slice(0, 8),
    });
  }
  return rows;
}

export class MyAutoListAdapter implements CatalogSourceAdapter {
  sourceId = "myauto_georgia_list";
  market = "georgia" as const;
  accessMode = "public_html" as const;

  async fetchPage(cursor?: string | null): Promise<CatalogFetchResult> {
    const page = Math.max(1, Number(cursor || 1));
    const attempts: string[] = [];
    for (const url of buildMyAutoListUrls(page)) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), Number(process.env.CATALOG_SOURCE_TIMEOUT_MS || 15_000));
      try {
        const response = await fetch(url, { headers: HEADERS, redirect: "follow", signal: controller.signal });
        const markup = await response.text();
        attempts.push(`${new URL(url).host}${new URL(url).pathname}${new URL(url).search}:${response.status}:${markup.length}`);
        if (!response.ok) continue;
        const items = parseMyAutoListingMarkup(markup, response.url || url);
        if (!items.length) continue;
        return {
          items,
          nextCursor: String(page + 1),
          finished: false,
          count: items.length,
          health: { ok: true, message: `MyAuto list parsed ${items.length} via ${new URL(response.url || url).host}`, checkedAt: new Date().toISOString(), httpStatus: response.status, contentType: response.headers.get("content-type") || "" },
        };
      } catch (error) {
        attempts.push(`${url}:${String((error as Error)?.message || error).slice(0, 160)}`);
      } finally { clearTimeout(timeout); }
    }
    throw new Error(`myauto_list_routes_failed:${attempts.join("|").slice(0, 1_500)}`);
  }

  mapStatus(): OfferStatus { return "active"; }

  normalizeOffer(raw: MyAutoListRow): VehicleOffer | null {
    if (!raw?.id || !raw.make || !raw.model || !raw.year || raw.year < 2020 || !raw.price || !raw.detailUrl) return null;
    const now = new Date().toISOString();
    const evidence = myAutoListingSpecificationEvidence(raw);
    const exactFuel = evidence.fuel.status === "exact" ? evidence.fuel.value : undefined;
    const offer = normalizeVehicleOfferSpecs({
      id: stableOfferId(this.sourceId, raw.id),
      sourceId: this.sourceId,
      sourceOfferId: raw.id,
      market: "georgia",
      offerType: "fixed",
      status: "active",
      make: raw.make,
      model: raw.model,
      trim: raw.title,
      year: raw.year,
      fuel: exactFuel,
      powertrainKind: powertrainKindForFuel(exactFuel),
      bodyType: raw.bodyType,
      sourcePrice: raw.price,
      sourceCurrency: raw.currency,
      priceMode: "fixed",
      images: [],
      totalRub: null,
      calculationStatus: "needs_data",
      firstSeenAt: now,
      updatedAt: now,
      operational: {
        sourceUrl: raw.detailUrl,
        sourceVenueName: raw.location || "Georgia",
        sourcePublishedAt: now,
        semanticEvidence: {
          year: { source: "myauto_listing", ...evidence.year },
          fuel: { source: "myauto_listing", ...evidence.fuel },
          engineCc: { source: "myauto_product_api", ...evidence.engineCc },
          powerHp: { source: "myauto_product_api", ...evidence.powerHp },
        },
        raw: { images: raw.images, parsed: raw, listingBoundImages: true },
      },
    } as VehicleOffer) as VehicleOffer;
    // Model names such as BMW 330 are not displacement evidence. MyAuto's
    // engine and power contract starts only at the identity-bound product API.
    offer.fuel = exactFuel;
    offer.powertrainKind = powertrainKindForFuel(exactFuel);
    offer.engineCc = undefined;
    offer.powerHp = undefined;
    offer.powerKw = undefined;
    offer.icePowerKw = undefined;
    offer.utilizationPowerKw = undefined;
    offer.powerDataConfidence = undefined;
    offer.powerDataSource = undefined;
    return offer;
  }

  async fetchImages(offer: VehicleOffer): Promise<CatalogImage[]> {
    const raw = offer.operational.raw as { images?: string[]; parsed?: MyAutoListRow } | undefined;
    const sourceId = String(offer.sourceOfferId || "");
    const listingUrls = [...new Set([...(raw?.images || []), ...(raw?.parsed?.images || [])])]
      .filter((url) => Boolean(parseMyAutoListingImageUrl(url, sourceId)));
    const listingIdentity = listingUrls.map((url) => parseMyAutoListingImageUrl(url, sourceId)).find(Boolean);
    const snapshot = await fetchMyAutoProductSnapshot(sourceId, listingIdentity?.photo).catch(() => null);
    const productEvidence = snapshot?.semanticEvidence || {
      engineCc: exactMetricEvidence([], 300, 10_000),
      powerHp: exactMetricEvidence([], 20, 2_500),
    };
    const engineEvidence = offer.powertrainKind === "electric" && productEvidence.engineCc.status === "exact"
      ? { ...productEvidence.engineCc, value: undefined, status: "conflict" as const }
      : productEvidence.engineCc;
    offer.engineCc = engineEvidence.status === "exact" ? engineEvidence.value : undefined;
    if (productEvidence.powerHp.status === "exact" && productEvidence.powerHp.value) {
      offer.powerHp = productEvidence.powerHp.value;
      offer.powerKw = Math.round(productEvidence.powerHp.value * 0.73549875 * 10) / 10;
      offer.powerDataConfidence = "source_exact";
      offer.powerDataSource = "MyAuto product API";
    } else {
      offer.powerHp = undefined;
      offer.powerKw = undefined;
      offer.icePowerKw = undefined;
      offer.utilizationPowerKw = undefined;
      offer.powerDataConfidence = undefined;
      offer.powerDataSource = undefined;
    }
    offer.operational = {
      ...(offer.operational || {}),
      semanticEvidence: {
        ...((offer.operational as any)?.semanticEvidence || {}),
        engineCc: { source: "myauto_product_api", ...engineEvidence },
        powerHp: { source: "myauto_product_api", ...productEvidence.powerHp },
      },
      raw: {
        ...((offer.operational?.raw as Record<string, unknown> | undefined) || {}),
        productSnapshotIdentityVerified: Boolean(snapshot),
      },
    };
    const exactGallery = snapshot?.galleryUrls || [];
    const urls = exactGallery.length ? exactGallery : listingUrls;
    const limit = Math.min(30, Math.max(1, Number(process.env.CATALOG_MAX_IMAGES_PER_OFFER || 30)));
    const saved: CatalogImage[] = [];
    for (const url of urls.slice(0, limit)) {
      const image = await cacheImageFromUrl(url, "georgia", { headers: { ...HEADERS, referer: offer.operational.sourceUrl || "https://www.myauto.ge/en/main" } }).catch(() => null);
      if (image && image.size > 8_000 && !saved.some((item) => item.id === image.id)) saved.push(image);
      if (saved.length >= limit) break;
    }
    return saved;
  }

  async healthCheck() {
    return { ok: true, message: "MyAuto public listing parser", checkedAt: new Date().toISOString() };
  }
}

export const myAutoListSource = new MyAutoListAdapter();
