import { canonicalCatalogBrand } from "./brands";
import { translateCatalogText } from "./presentation";
import { stableOfferId } from "./storage";
import type { CatalogFetchResult, CatalogImage, CatalogSourceAdapter, OfferStatus, VehicleOffer } from "./types";

type KbListRow = {
  carSeq: string;
  title: string;
  make: string;
  model: string;
  trim: string;
  year: number;
  mileageKm?: number;
  sourcePrice: number;
  images: string[];
  detailUrl: string;
};

const BASE = "https://www.kbchachacha.com";
const IMAGE_HOST = "img.kbchachacha.com";
const HEADERS = {
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "accept-language": "ko-KR,ko;q=0.9,en;q=0.7",
  "cache-control": "no-cache",
  pragma: "no-cache",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
};
const BLOCKED = /captcha|cloudflare|access denied|request blocked|verify you are human|forbidden/i;

function clean(value: unknown) {
  return String(value ?? "")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function integer(value: unknown) {
  const parsed = Number(String(value ?? "").replace(/[^0-9]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function fourDigitYear(value: unknown) {
  const source = clean(value);
  const direct = Number(source.match(/\b(?:19|20)\d{2}\b/)?.[0] || 0);
  if (direct) return direct;
  const modelYear = Number(source.match(/(?:\(|\s)(\d{2})\s*년형\)?/)?.[1] || 0);
  const registrationYear = Number(source.match(/(?:^|\s)(\d{2})\s*년\s*\d{1,2}\s*월/)?.[1] || 0);
  const short = modelYear || registrationYear;
  if (!short) return 0;
  const currentShort = (new Date().getFullYear() + 1) % 100;
  return short <= currentShort ? 2000 + short : 1900 + short;
}

function exactImageUrl(value: unknown, carSeq: string) {
  try {
    const url = new URL(String(value || "").replace(/&amp;/g, "&"), BASE);
    if (url.protocol !== "https:" || url.hostname.toLowerCase() !== IMAGE_HOST) return "";
    if (!url.pathname.toLowerCase().includes("/img/carimg/") || !url.pathname.includes(`/${carSeq}_`)) return "";
    if (!/\.(?:jpe?g|webp)$/i.test(url.pathname)) return "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return "";
  }
}

function listImages(card: string, carSeq: string) {
  const urls = [...card.matchAll(/<(?:img|source)\b[^>]*>/gi)]
    .map((tag) => tag[0].match(/(?:^|\s)(?:data-src|src)\s*=\s*["']([^"']+)["']/i)?.[1] || "")
    .map((value) => exactImageUrl(value, carSeq))
    .filter(Boolean);
  return [...new Set(urls)].slice(0, 30);
}

function splitTitle(value: unknown) {
  const source = clean(value);
  const [rawMake = "", ...rest] = source.split(/\s+/);
  const makeToken = rawMake.replace(/^한국GM$/i, "쉐보레");
  const make = canonicalCatalogBrand(clean(translateCatalogText(makeToken)) || makeToken);
  const modelSource = rest.join(" ")
    .replace(/더\s*뉴\s*말리부/gi, "The New Malibu")
    .replace(/말리부/gi, "Malibu")
    .replace(/터보/gi, "Turbo")
    .replace(/스페셜/gi, "Special");
  const translated = clean(translateCatalogText(modelSource));
  const model = translated || clean(rest.join(" "));
  return { title: [make, model].filter(Boolean).join(" "), make, model, trim: model };
}

function titleEngineCc(value: unknown) {
  const liters = Number(clean(value).match(/(?:^|\s)([0-9](?:[.,][0-9]))(?=\s|$)/)?.[1]?.replace(",", ".") || 0);
  return liters >= 0.6 && liters <= 8 ? Math.round(liters * 1_000) : undefined;
}

export function parseKbChaChaChaList(markup: string): KbListRow[] {
  const starts = [...markup.matchAll(/<div\b[^>]*\bdata-car-seq=["'](\d+)["'][^>]*>/gi)];
  const rows: KbListRow[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < starts.length; index++) {
    const carSeq = String(starts[index][1] || "");
    if (!carSeq || seen.has(carSeq)) continue;
    const start = starts[index].index || 0;
    const end = index + 1 < starts.length ? starts[index + 1].index || markup.length : markup.length;
    const card = markup.slice(start, end);
    const rawTitle = clean(card.match(/<strong\b[^>]*class=["'][^"']*\btit\b[^"']*["'][^>]*>([\s\S]*?)<\/strong>/i)?.[1] || "");
    const yearText = clean(card.match(/<div\b[^>]*class=["'][^"']*\bdata-line\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] || card);
    const year = fourDigitYear(yearText);
    const mileageKm = integer(yearText.match(/([0-9][0-9\s,.']*)\s*km/i)?.[1]);
    const manwon = integer(card.match(/<span\b[^>]*class=["'][^"']*\bprice\b[^"']*["'][^>]*>\s*([0-9][0-9\s,.']*)\s*<span\b[^>]*class=["'][^"']*\bunit\b/i)?.[1]);
    const parsed = splitTitle(rawTitle);
    const images = listImages(card, carSeq);
    if (!parsed.make || !parsed.model || !year || !manwon || !images.length) continue;
    seen.add(carSeq);
    rows.push({
      carSeq,
      ...parsed,
      year,
      mileageKm,
      sourcePrice: manwon * 10_000,
      images,
      detailUrl: `${BASE}/public/car/detail.kbc?carSeq=${encodeURIComponent(carSeq)}`,
    });
  }
  return rows;
}

function productJson(markup: string) {
  for (const match of markup.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(match[1]);
      if (parsed?.["@type"] === "Product") return parsed;
    } catch {
      // Ignore unrelated malformed analytics JSON.
    }
  }
  return null;
}

function tableValue(markup: string, label: string) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return clean(markup.match(new RegExp(`<th\\b[^>]*>\\s*${escaped}\\s*<\\/th>\\s*<td\\b[^>]*>([\\s\\S]*?)<\\/td>`, "i"))?.[1] || "");
}

export function parseKbChaChaChaDetail(markup: string, carSeq: string) {
  const product = productJson(markup);
  if (!product) throw new Error(`kbchachacha_detail_product_missing_${carSeq}`);
  const offerUrl = String(product?.offers?.url || "");
  let boundId = "";
  try { boundId = new URL(offerUrl, BASE).searchParams.get("carSeq") || ""; } catch {}
  if (boundId !== carSeq) throw new Error(`kbchachacha_detail_identity_${carSeq}`);
  const images = (Array.isArray(product.image) ? product.image : [product.image])
    .map((value: unknown) => exactImageUrl(value, carSeq))
    .filter(Boolean);
  const uniqueImages = [...new Set(images)].slice(0, 30);
  if (uniqueImages.length < 5) throw new Error(`kbchachacha_detail_gallery_${carSeq}_${uniqueImages.length}`);
  const parsedTitle = splitTitle(String(product.name || "").replace(/\([^)]*년형[^)]*\)/g, ""));
  const year = fourDigitYear(`${product.name || ""} ${product.description || ""} ${tableValue(markup, "연식")}`);
  const sourcePrice = integer(product?.offers?.price);
  if (!parsedTitle.make || !parsedTitle.model || !year || !sourcePrice) throw new Error(`kbchachacha_detail_fields_${carSeq}`);
  return {
    ...parsedTitle,
    year,
    sourcePrice,
    mileageKm: integer(tableValue(markup, "주행거리")),
    fuel: tableValue(markup, "연료"),
    transmission: tableValue(markup, "변속기"),
    bodyType: tableValue(markup, "차종"),
    engineCc: integer(tableValue(markup, "배기량")),
    color: tableValue(markup, "차량색상"),
    images: uniqueImages,
  };
}

async function requestMarkup(url: string, referer: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.CATALOG_SOURCE_TIMEOUT_MS || 35_000));
  try {
    const response = await fetch(url, { headers: { ...HEADERS, referer }, redirect: "follow", signal: controller.signal });
    const markup = await response.text();
    if (response.status === 429 || BLOCKED.test(markup.slice(0, 4_000))) throw new Error(`kbchachacha_blocked_${response.status}`);
    if (!response.ok) throw new Error(`kbchachacha_http_${response.status}`);
    return { response, markup };
  } finally {
    clearTimeout(timeout);
  }
}

let detailPausedUntil = 0;
let detailQueue: Promise<void> = Promise.resolve();
let detailLastStartedAt = 0;

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function detailMinIntervalMs() {
  const configured = Number(process.env.KBCHACHACHA_DETAIL_MIN_INTERVAL_MS || 750);
  return Number.isFinite(configured) ? Math.max(0, configured) : 750;
}

function detailPauseMs() {
  const configured = Number(process.env.KBCHACHACHA_DETAIL_PAUSE_MS || 10 * 60_000);
  return Number.isFinite(configured) ? Math.max(60_000, configured) : 10 * 60_000;
}

async function requestDetailMarkup(url: string, referer: string) {
  const run = detailQueue.then(async () => {
    if (Date.now() < detailPausedUntil) return null;
    const waitMs = Math.max(0, detailLastStartedAt + detailMinIntervalMs() - Date.now());
    if (waitMs > 0) await sleep(waitMs);
    detailLastStartedAt = Date.now();
    try {
      return await requestMarkup(url, referer);
    } catch (error) {
      if (/kbchachacha_blocked_\d+/i.test(String((error as Error)?.message || error))) {
        detailPausedUntil = Date.now() + detailPauseMs();
        return null;
      }
      throw error;
    }
  });
  detailQueue = run.then(() => undefined, () => undefined);
  return run;
}

function listingGallery(offer: VehicleOffer) {
  const raw = typeof offer.operational?.raw === "object" && offer.operational.raw ? offer.operational.raw as Record<string, unknown> : {};
  const carSeq = String(offer.sourceOfferId || "");
  const urls = Array.isArray(raw.listingImages)
    ? raw.listingImages.map((value) => exactImageUrl(value, carSeq)).filter(Boolean)
    : [];
  if (!urls.length) throw new Error(`kbchachacha_listing_gallery_missing_${carSeq}`);
  offer.operational = {
    ...(offer.operational || {}),
    photoIdentityVerified: true,
    vehiclePhotoVerified: true,
    galleryVerified: true,
    galleryImageCount: urls.length,
    gallerySafetyMode: "kbchachacha_exact_listing_card_car_seq_v1",
    raw: { ...raw, listingBoundImages: true, photoIdentityVerified: true, images: urls },
  };
  return urls.map(image);
}

function image(url: string): CatalogImage {
  return { id: "", url, objectKey: "", checksum: "", size: 0, mimeType: /\.webp$/i.test(new URL(url).pathname) ? "image/webp" : "image/jpeg" };
}

class KbChaChaChaExactSource implements CatalogSourceAdapter {
  sourceId = "kbchachacha_korea_open";
  market = "korea" as const;
  accessMode = "public_html" as const;

  async fetchPage(cursor?: string | null): Promise<CatalogFetchResult> {
    const page = Math.max(1, Number(cursor || 1));
    const url = `${BASE}/public/search/list.empty?page=${page}&sort=-orderDate`;
    const { response, markup } = await requestMarkup(url, `${BASE}/public/search/main.kbc`);
    const items = parseKbChaChaChaList(markup);
    const rawCount = new Set([...markup.matchAll(/\bdata-car-seq=["'](\d+)["']/gi)].map((match) => match[1])).size;
    if (rawCount > 0 && !items.length) throw new Error(`kbchachacha_parsed_zero_${response.status}_${markup.length}`);
    const finished = rawCount === 0;
    return {
      items,
      nextCursor: finished ? null : String(page + 1),
      finished,
      count: items.length,
      health: { ok: rawCount > 0, message: `KB ChaChaCha page ${page}: ${items.length}/${rawCount}`, checkedAt: new Date().toISOString(), httpStatus: response.status },
    };
  }

  normalizeOffer(raw: unknown): VehicleOffer | null {
    const row = raw as KbListRow;
    if (!row?.carSeq || !row.make || !row.model || !row.year || !row.sourcePrice || !row.images?.length) return null;
    const now = new Date().toISOString();
    return {
      id: stableOfferId(this.sourceId, row.carSeq),
      sourceId: this.sourceId,
      sourceOfferId: row.carSeq,
      market: "korea",
      offerType: "fixed",
      status: "active",
      sourceTitle: row.title,
      make: row.make,
      model: row.model,
      trim: row.trim,
      year: row.year,
      mileageKm: row.mileageKm,
      engineCc: titleEngineCc(row.title),
      sourcePrice: row.sourcePrice,
      sourceCurrency: "KRW",
      priceMode: "fixed",
      images: row.images.map(image),
      totalRub: null,
      calculationStatus: "needs_data",
      firstSeenAt: now,
      updatedAt: now,
      operational: {
        sourceUrl: row.detailUrl,
        sourceTitle: row.title,
        detailIdentityVerified: false,
        fieldIdentityVerified: true,
        photoIdentityVerified: true,
        vehiclePhotoVerified: true,
        galleryVerified: true,
        galleryImageCount: row.images.length,
        gallerySafetyMode: "kbchachacha_exact_listing_card_car_seq_v1",
        raw: { listingImages: row.images, listingBoundImages: true, photoIdentityVerified: true, listingCarSeq: row.carSeq, listingYear: row.year, listingPrice: row.sourcePrice },
      },
    };
  }

  async fetchImages(offer: VehicleOffer): Promise<CatalogImage[]> {
    const carSeq = String(offer.sourceOfferId || "");
    if (!carSeq) throw new Error("kbchachacha_gallery_missing_id");
    const detailUrl = `${BASE}/public/car/detail.kbc?carSeq=${encodeURIComponent(carSeq)}`;
    const detailResult = await requestDetailMarkup(detailUrl, `${BASE}/public/search/main.kbc`);
    if (!detailResult) return listingGallery(offer);
    const { markup } = detailResult;
    const detail = parseKbChaChaChaDetail(markup, carSeq);
    if (canonicalCatalogBrand(String(offer.make || "")) !== canonicalCatalogBrand(detail.make)) throw new Error(`kbchachacha_make_mismatch_${carSeq}`);
    if (Number(offer.year || 0) !== detail.year || Number(offer.sourcePrice || 0) !== detail.sourcePrice) throw new Error(`kbchachacha_listing_detail_mismatch_${carSeq}`);
    offer.make = detail.make;
    offer.model = detail.model;
    offer.trim = detail.trim;
    offer.mileageKm = detail.mileageKm || offer.mileageKm;
    offer.engineCc = detail.engineCc;
    offer.fuel = detail.fuel;
    offer.transmission = detail.transmission;
    offer.bodyType = detail.bodyType;
    offer.color = detail.color;
    offer.operational = {
      ...(offer.operational || {}),
      detailIdentityVerified: true,
      fieldIdentityVerified: true,
      photoIdentityVerified: true,
      vehiclePhotoVerified: true,
      galleryVerified: true,
      galleryImageCount: detail.images.length,
      gallerySafetyMode: "kbchachacha_exact_product_gallery_car_seq_v1",
      raw: {
        ...(typeof offer.operational?.raw === "object" && offer.operational.raw ? offer.operational.raw : {}),
        detailIdentityVerified: true,
        photoIdentityVerified: true,
        listingBoundImages: true,
        images: detail.images,
        detailEngineCc: detail.engineCc,
      },
    };
    return detail.images.map(image);
  }

  mapStatus(): OfferStatus { return "active"; }

  async healthCheck() {
    try {
      const page = await this.fetchPage("1");
      return page.health || { ok: false, message: "KB ChaChaCha health unavailable", checkedAt: new Date().toISOString() };
    } catch (error) {
      return { ok: false, message: String((error as Error)?.message || error), checkedAt: new Date().toISOString() };
    }
  }
}

export const kbChaChaChaExactSource = new KbChaChaChaExactSource();
