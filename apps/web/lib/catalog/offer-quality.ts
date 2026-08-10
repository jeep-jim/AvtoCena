import type { CatalogImage, VehicleOffer } from "./types";
import { catalogImageScore, isLikelyVehicleImage } from "./image-quality";
import { REQUIRED_CATALOG_SOURCES } from "./required-catalog-sources";

const GENERIC_LISTING_RE = /(?:exclusively\s+on|read\s+more|learn\s+more|breaking\s+news|latest\s+news|car\s+news|road\s+test|article|blog|magazine|toonaan|deze\s+elektr|highly\s+responsive|certified\s+pre\s+owned|\b(?:aed|usd|eur)\s*\d+\s*\/\s*month\b|\b0\s*dp\b|\b\d+\s*day\s*return\b|\breturn\s+warranty\b|^location$|^alle\s+|未上传图片|暂无图片|扫码|二维码|联系卖家|&(?:#\d+|[a-z]+);)/i;
const NON_VEHICLE_RE = /(?:motorcycle|motorbike|scooter|forklift|excavator|bulldozer|tractor|crane|generator|boat|ship|machinery|spare\s+parts?|engine\s+only|автозапчаст|мотоцикл|погрузчик|генератор)/i;
const BAD_IMAGE_RE = /(?:no[-_ ]?photo|no[-_ ]?image|nophoto|noimage|image[-_ ]?not[-_ ]?available|coming[-_ ]?soon|default[-_ ]?(?:car|vehicle|image)|upload[-_ ]?image|placeholder|qrcode|qr-code|qr_|weixin|wechat|scan|download[-_ ]?app|appstore|googleplay|favicon|sprite|tracking|pixel|social|share[-_ ]?icon|camera[-_ ]?off|dummy[-_ ]?(?:car|image)|cdn-cgi|challenge-platform)/i;
const ALTERNATIVE_POWERTRAIN_RE = /(?:hybrid|phev|hev|electric|\bbev\b|\bev\b|гибрид|электро)/i;
const REQUIRED_SOURCE_IDS = new Set(Object.values(REQUIRED_CATALOG_SOURCES).flat().map((source) => source.sourceId));
const BUSINESS_LIQUIDITY_RECENT_YEARS = 6;
const BUSINESS_LIQUIDITY_OLDER_MAX_POWER_HP = 160;

function clean(value: unknown) { return String(value || "").replace(/\s+/g, " ").trim(); }
function meaningfulTitle(value: unknown) {
  const text = clean(value);
  return text.length >= 2 && text.length <= 180 && /[\p{L}\p{N}]/u.test(text) && !GENERIC_LISTING_RE.test(text) && !NON_VEHICLE_RE.test(text);
}
function mashinaSourcePhotoIdentity(value: unknown) {
  const source = String(value || "").trim();
  if (!source) return "";
  try {
    const url = new URL(source);
    const host = url.hostname.toLowerCase();
    let pathname = decodeURIComponent(url.pathname).replace(/\/{2,}/g, "/");
    if (host === "storage.mashina.kg") {
      pathname = pathname.replace(/_(?:small|medium|large)(?=\.(?:jpe?g|png|webp|avif)$)/i, "");
      return `mashina:${host}${pathname}`;
    }
    if (host === "im.mashina.kg") {
      pathname = pathname.replace(/_\d{2,5}x\d{2,5}(?=\.(?:jpe?g|png|webp|avif)$)/i, "");
      return `mashina:${host}${pathname}`;
    }
  } catch { /* fall through to stored identity */ }
  return "";
}
function imageIdentity(image: CatalogImage) {
  return mashinaSourcePhotoIdentity(image.url)
    || String(image.checksum || image.id || image.objectKey || image.url || "");
}

export function credibleCatalogImages(images: CatalogImage[]) {
  const unique = new Map<string, CatalogImage>();
  for (const image of images || []) {
    const url = String(image?.url || image?.objectKey || "");
    if (!image || !url || BAD_IMAGE_RE.test(url) || !isLikelyVehicleImage(image)) continue;
    const key = imageIdentity(image);
    if (!key) continue;
    const existing = unique.get(key);
    if (!existing || catalogImageScore(image) > catalogImageScore(existing)) unique.set(key, image);
  }
  return [...unique.values()].slice(0, 30);
}

function sourcePriceOk(offer: VehicleOffer) {
  const price = Number(offer.sourcePrice || 0);
  return Number.isFinite(price) && price > 0 && clean(offer.sourceCurrency).length > 0;
}
function mileageOk(offer: VehicleOffer) {
  if (offer.mileageKm === undefined || offer.mileageKm === null) return true;
  const mileage = Number(offer.mileageKm);
  return Number.isFinite(mileage) && mileage >= 0 && mileage <= 5_000_000;
}
function listingTitle(offer: VehicleOffer) {
  return clean(
    offer.sourceTitle
      || offer.operational?.sourceTitle
      || [offer.make, offer.model, offer.trim].filter(Boolean).join(" "),
  );
}

export function isCatalogOfferBusinessLiquid(offer: VehicleOffer) {
  const currentYear = new Date().getFullYear();
  const year = Number(offer.year || 0);
  const powerHp = Number(offer.powerHp || 0);
  if (!year || year >= currentYear - BUSINESS_LIQUIDITY_RECENT_YEARS || !(powerHp > BUSINESS_LIQUIDITY_OLDER_MAX_POWER_HP)) return true;

  // Do not apply an ICE horsepower heuristic to EV/PHEV/hybrid cards because
  // their public horsepower field may not be the utilization-power value.
  const powertrainKind = clean(offer.powertrainKind).toLowerCase();
  if (["electric", "series_hybrid", "other_hybrid"].includes(powertrainKind)) return true;
  if (ALTERNATIVE_POWERTRAIN_RE.test(clean(offer.fuel))) return true;

  return false;
}

function minimumImageCount(offer: VehicleOffer) {
  // Japan remains strict because auction-sheet/gallery identity is part of the
  // completed-lot contract. Normal live-market listings are valid with one
  // source-bound vehicle photo and may enrich the same card with more later.
  // Do not use the current workflow's global image threshold for other markets:
  // a strict Japan publisher must never purge preserved UAE/Georgia/KG rows.
  if (offer.market === "japan") return offer.sourceId === "jpauc_japan_past_open" ? 3 : 5;
  return 1;
}

function mandatorySourcePhotoIdentityVerified(offer: VehicleOffer) {
  if (!REQUIRED_SOURCE_IDS.has(String(offer.sourceId || ""))) return true;
  const operational: any = offer.operational || {};
  const raw: any = operational.raw || {};

  if (operational.photoIdentityVerified === true
    || raw.photoIdentityVerified === true
    || raw.detailIdentityVerified === true
    || raw.listingBoundImages === true) return true;

  // Encar exact detail was verified card-by-card and its dedicated adapter only
  // returns photos from the current source offer.
  if (offer.sourceId === "encar_direct"
    && operational.galleryVerified === true
    && ["encar_source_urls_only", "encar_detail_only_v2"].includes(String(operational.gallerySafetyMode || ""))) return true;

  // JPAuc rows are keyed by the auction data-id. The Aleado image URL stored in
  // that same row is the listing-bound auction sheet/gallery for that exact lot.
  if (offer.sourceId === "jpauc_japan_past_open"
    && operational.historicalAuction === true
    && Number(operational.minimumImages || 0) === 3
    && String(raw?.dataId || "") === String(offer.sourceOfferId || "")) return true;

  return false;
}

function credibleCoreContent(offer: VehicleOffer) {
  const currentYear = new Date().getFullYear();
  const year = Number(offer.year || 0);
  const title = listingTitle(offer);
  if (!meaningfulTitle(title)) return false;
  if (year < currentYear - 15 || year > currentYear + 1) return false;
  if (!isCatalogOfferBusinessLiquid(offer)) return false;
  if (!sourcePriceOk(offer) || !mileageOk(offer)) return false;
  if (NON_VEHICLE_RE.test([title, offer.make, offer.model, offer.trim, offer.bodyType].map(clean).join(" "))) return false;
  return credibleCatalogImages(offer.images || []).length >= minimumImageCount(offer);
}

export function hasCredibleOfferContent(offer: VehicleOffer) {
  return credibleCoreContent(offer)
    && /^https?:\/\//i.test(clean(offer.operational?.sourceUrl))
    && mandatorySourcePhotoIdentityVerified(offer);
}

// Public API DTOs intentionally omit operational metadata. Server-side storage
// has already applied hasCredibleOfferContent(), so the client only re-checks
// the visible core fields here.
export function isCrediblePublicOffer(offer: VehicleOffer) {
  return offer.status === "active" && credibleCoreContent(offer);
}
