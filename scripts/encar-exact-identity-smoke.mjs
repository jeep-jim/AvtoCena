import fs from "node:fs/promises";
import { EncarCompleteAdapter } from "../apps/web/lib/catalog/encar-complete-source.ts";
import { buildEncarImageUrl, normalizeEncarPrice } from "../apps/web/lib/catalog/adapters.ts";

process.env.CATALOG_MAX_IMAGES_PER_OFFER = "10";
process.env.CATALOG_REBUILD_MIN_IMAGES_PER_OFFER = "5";
process.env.CATALOG_SOURCE_REQUEST_TIMEOUT_MS = "30000";
process.env.CATALOG_ENCAR_DIRECT_PAGE_SIZE = "20";

const OUT = "encar-exact-identity-smoke.json";
const adapter = new EncarCompleteAdapter();

function text(value) {
  return value == null ? "" : String(value).trim().replace(/\\\//g, "/");
}
function positive(value) {
  const n = Number(String(value ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}
function deepFind(value, keys, depth = 0) {
  if (value == null || depth > 12 || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = deepFind(item, keys, depth + 1);
      if (found !== undefined && found !== null && text(found)) return found;
    }
    return undefined;
  }
  for (const key of keys) {
    const direct = value[key];
    if (direct !== undefined && direct !== null && text(direct)) return direct;
  }
  for (const child of Object.values(value)) {
    const found = deepFind(child, keys, depth + 1);
    if (found !== undefined && found !== null && text(found)) return found;
  }
  return undefined;
}
function imageLike(value) {
  return /ci\.encar\.com|\/carpicture\/|\.(?:jpe?g|png|webp)(?:[?#]|$)/i.test(value);
}
function collectDetailImageValues(value, key = "", depth = 0, out = []) {
  if (value == null || depth > 14) return out;
  if (typeof value === "string") {
    const candidate = text(value);
    if (candidate && imageLike(candidate) && /photo|image|picture|gallery|media|location|path|url|^$/i.test(key)) out.push(candidate);
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectDetailImageValues(item, key, depth + 1, out));
    return out;
  }
  if (typeof value !== "object") return out;
  for (const [childKey, child] of Object.entries(value)) {
    if (/photo|image|picture|gallery|media|location|path|url/i.test(childKey) || depth < 7) collectDetailImageValues(child, childKey, depth + 1, out);
  }
  return out;
}
function absoluteImageUrl(value) {
  const raw = text(value);
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  return buildEncarImageUrl(raw, 1);
}
function canonical(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return `${parsed.hostname.toLowerCase()}${parsed.pathname}${parsed.search}`;
  } catch {
    return text(url).toLowerCase();
  }
}
function rawYear(raw) {
  const found = text(raw?.FormYear || raw?.Year || raw?.YearMonth).match(/(?:19|20)\d{2}/)?.[0];
  return found ? Number(found) : null;
}
async function checkImage(url) {
  try {
    const response = await fetch(url, {
      headers: {
        accept: "image/avif,image/webp,image/*,*/*;q=0.8",
        referer: "https://fem.encar.com/",
        range: "bytes=0-32767",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150.0.0.0 Safari/537.36",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(30000),
    });
    const bytes = new Uint8Array(await response.arrayBuffer()).length;
    return { url, ok: response.ok && /^image\//i.test(response.headers.get("content-type") || "") && bytes > 500, status: response.status, contentType: response.headers.get("content-type") || "", bytes };
  } catch (error) {
    return { url, ok: false, status: 0, contentType: "", bytes: 0, error: String(error?.message || error) };
  }
}

let cursor = null;
let selected = null;
const attempts = [];
let pagesScanned = 0;
let candidatesScanned = 0;

for (let pageIndex = 0; pageIndex < 3 && !selected; pageIndex++) {
  const page = await adapter.fetchPage(cursor);
  pagesScanned++;
  for (const raw of page.items || []) {
    if (candidatesScanned >= 20 || selected) break;
    candidatesScanned++;
    const offer = adapter.normalizeOffer(raw);
    if (!offer) continue;

    try {
      const listingPrice = normalizeEncarPrice(raw?.Price);
      const listingYear = rawYear(raw);
      const listingMileage = positive(raw?.Mileage);
      const images = await adapter.fetchImages(offer);
      const nested = offer.operational?.raw || {};
      const listing = nested.offer || raw;
      const detail = nested.detail || {};
      const exactDetailUrls = [...new Set(collectDetailImageValues(detail).map(absoluteImageUrl).filter(Boolean))];
      const detailUrlSet = new Set(exactDetailUrls.map(canonical));
      const returnedUrls = images.map((image) => text(image.url)).filter(Boolean);
      const imageChecks = await Promise.all(returnedUrls.slice(0, 3).map(checkImage));
      const sourcePower = positive(deepFind(detail?.vehicle || detail?.Vehicle || detail, ["power", "Power", "horsePower", "horsepower", "ps"]));

      const checks = {
        exactId: Boolean(offer.sourceOfferId),
        exactSourceUrl: offer.operational?.sourceUrl === `https://fem.encar.com/cars/detail/${offer.sourceOfferId}`,
        sourceIdentity: offer.sourceId === "encar_direct" && offer.market === "korea" && Boolean(offer.make && offer.model),
        priceMatchesListing: listingPrice !== null && Number(offer.sourcePrice) === Number(listingPrice) && offer.sourceCurrency === "KRW",
        yearMatchesListing: listingYear !== null && Number(offer.year) === listingYear,
        mileageMatchesListing: listingMileage !== null && Number(offer.mileageKm) === listingMileage,
        detailAttachedToExactOffer: Boolean(detail && typeof detail === "object" && Object.keys(detail).length > 0),
        galleryVerified: offer.operational?.galleryVerified === true,
        photoIdentityVerified: offer.operational?.photoIdentityVerified === true,
        exactGalleryMode: offer.operational?.gallerySafetyMode === "encar_detail_only_v2",
        enoughImages: images.length >= 5,
        sourceUrlsOnly: images.every((image) => /^https?:\/\//i.test(text(image.url)) && !image.objectKey && !image.checksum && Number(image.size || 0) === 0),
        everyReturnedImageComesFromExactDetail: returnedUrls.length > 0 && returnedUrls.every((url) => detailUrlSet.has(canonical(url))),
        firstThreeImagesOpen: imageChecks.length === 3 && imageChecks.every((check) => check.ok),
      };

      attempts.push({ sourceOfferId: offer.sourceOfferId, make: offer.make, model: offer.model, checks, imageCount: images.length, sourcePower: sourcePower ?? null });
      if (Object.values(checks).every(Boolean)) {
        selected = {
          sourceId: offer.sourceId,
          sourceOfferId: offer.sourceOfferId,
          sourceUrl: offer.operational?.sourceUrl,
          make: offer.make,
          model: offer.model,
          trim: offer.trim || null,
          year: offer.year,
          mileageKm: offer.mileageKm,
          sourcePrice: offer.sourcePrice,
          sourceCurrency: offer.sourceCurrency,
          powerHp: offer.powerHp || null,
          sourcePower: sourcePower ?? null,
          powerState: sourcePower ? "found_in_exact_detail" : "not_provided_keep_unspecified",
          imageCount: images.length,
          images: returnedUrls,
          imageChecks,
          checks,
          knowledgeDatabaseUsed: false,
          productionPublished: false,
        };
      }
    } catch (error) {
      attempts.push({ sourceOfferId: offer.sourceOfferId, make: offer.make, model: offer.model, error: String(error?.message || error) });
    }
  }
  cursor = page.nextCursor || null;
  if (!cursor || page.finished) break;
}

const report = {
  checkedAt: new Date().toISOString(),
  mode: "one_exact_encar_card_detail_only_no_knowledge_no_publication",
  passed: Boolean(selected),
  pagesScanned,
  candidatesScanned,
  selected,
  attempts,
};
await fs.writeFile(OUT, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (!selected) process.exit(1);
