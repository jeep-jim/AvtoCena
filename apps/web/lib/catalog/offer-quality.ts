import type { CatalogImage, VehicleOffer } from "./types";
import { catalogImageScore, isLikelyVehicleImage } from "./image-quality";
import { REQUIRED_CATALOG_SOURCES } from "./required-catalog-sources";
import { isEncarNonCashContractOffer } from "./encar-sale-contract";

const GENERIC_LISTING_RE = /(?:exclusively\s+on|read\s+more|learn\s+more|breaking\s+news|latest\s+news|car\s+news|road\s+test|article|blog|magazine|toonaan|deze\s+elektr|highly\s+responsive|certified\s+pre\s+owned|\b(?:aed|usd|eur)\s*\d+\s*\/\s*month\b|\b0\s*dp\b|\b\d+\s*day\s*return\b|\breturn\s+warranty\b|^location$|^alle\s+|未上传图片|暂无图片|扫码|二维码|联系卖家|&(?:#\d+|[a-z]+);)/i;
const NON_VEHICLE_RE = /(?:motorcycle|motorbike|scooter|jet\s*ski|watercraft|personal\s+watercraft|super\s+jet|forklift|excavator|bulldozer|tractor|crane|generator|boat|ship|machinery|spare\s+parts?|engine\s+only|автозапчаст|мотоцикл|погрузчик|генератор)/i;
const NON_PASSENGER_BODY_RE = /^(?:truck|light[\s-]*truck|heavy[\s-]*truck|lorry|commercial(?:\s+vehicle)?|bus|coach|special(?:\s+purpose)?(?:\s+vehicle)?|machinery)$/i;
const BAD_IMAGE_RE = /(?:no[-_ ]?photo|no[-_ ]?image|nophoto|noimage|image[-_ ]?not[-_ ]?available|coming[-_ ]?soon|default[-_ ]?(?:car|vehicle|image)|upload[-_ ]?image|placeholder|qrcode|qr-code|qr_|weixin|wechat|scan|download[-_ ]?app|appstore|googleplay|favicon|sprite|tracking|pixel|social|share[-_ ]?icon|camera[-_ ]?off|dummy[-_ ]?(?:car|image)|\/users\/|cdn-cgi|challenge-platform)/i;
const ALTERNATIVE_POWERTRAIN_RE = /(?:hybrid|phev|hev|electric|\bbev\b|\bev\b|гибрид|электро)/i;
const INVALID_CATALOG_IDENTITY_RE = /^(?:unknown|undefined|null|none|n\/?a|not\s+(?:specified|available|known)|other(?:s)?|andere|brand|make|model|марка(?:\s+уточняется)?|модель(?:\s+уточняется)?|уточняется|не\s+указано|неизвестно|기타|미상|其他|未知|その他)$/iu;
const REQUIRED_SOURCE_IDS = new Set(Object.values(REQUIRED_CATALOG_SOURCES).flat().map((source) => source.sourceId));
const GEORGIA_ALLOWED_SOURCE_IDS = new Set(["myauto_georgia_list", "myauto_georgia_exact", "autopapa_georgia_open"]);
const BUSINESS_LIQUIDITY_RECENT_YEARS = 5;
const BUSINESS_LIQUIDITY_OLDER_MAX_POWER_HP = 160;
export const CATALOG_NON_JAPAN_MIN_YEAR = 2020;
export const CATALOG_JAPAN_MIN_YEAR = 2010;

export function isCatalogMarketSourceAllowed(offer: Pick<VehicleOffer, "market" | "sourceId">) {
  if (String(offer.market || "") !== "georgia") return true;
  return GEORGIA_ALLOWED_SOURCE_IDS.has(String(offer.sourceId || ""));
}

export function catalogMinYearForMarket(marketValue: unknown) {
  const market = String(marketValue || "").trim().toLowerCase();
  return market === "japan" ? CATALOG_JAPAN_MIN_YEAR : CATALOG_NON_JAPAN_MIN_YEAR;
}
export function isCatalogYearAllowed(yearValue: unknown, marketValue?: unknown) {
  const year = Number(yearValue || 0);
  const currentYear = new Date().getFullYear();
  return Number.isFinite(year) && year >= catalogMinYearForMarket(marketValue) && year <= currentYear + 1;
}

function clean(value: unknown) { return String(value || "").replace(/\s+/g, " ").trim(); }
function credibleIdentityValue(value: unknown) {
  const identity = clean(value);
  return identity.length > 0
    && identity.length <= 80
    && /[\p{L}\p{N}]/u.test(identity)
    && !INVALID_CATALOG_IDENTITY_RE.test(identity);
}
export function hasCredibleCatalogIdentity(offer: Pick<VehicleOffer, "make" | "model">) {
  const make = clean(offer.make);
  const model = clean(offer.model);
  if (!credibleIdentityValue(make) || !credibleIdentityValue(model)) return false;
  // "Benz" is never a model family for modern Mercedes-Benz stock. It appears
  // when a source/normalizer collapses the make token into the model field and
  // cannot be safely matched to Encyclopedia variants, so fail closed.
  if (/^Mercedes[- ]?Benz$/i.test(make) && /^Benz$/i.test(model)) return false;
  return true;
}
function meaningfulTitle(value: unknown) {
  const text = clean(value);
  return text.length >= 2 && text.length <= 180 && /[\p{L}\p{N}]/u.test(text) && !GENERIC_LISTING_RE.test(text) && !NON_VEHICLE_RE.test(text);
}
export function isNonPassengerCatalogBodyType(value: unknown) {
  return NON_PASSENGER_BODY_RE.test(clean(value));
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

export function isCatalogKnownBodySemanticValid(offer: Pick<VehicleOffer, "market" | "make" | "model" | "trim" | "sourceTitle" | "bodyType">) {
  if (clean(offer.market).toLowerCase() !== "korea") return true;
  if (!/^(?:suv|crossover|offroad)$/i.test(clean(offer.bodyType))) return true;
  const make = clean(offer.make);
  const identity = [offer.model, offer.trim, offer.sourceTitle].map(clean).filter(Boolean).join(" ");
  if (/^(?:genesis|제네시스)$/i.test(make) && /\bG80\b/i.test(identity)) return false;
  if (/^(?:hyundai|현대)$/i.test(make) && /(?:\bGrandeur\b|그랜저|\bIoniq\s*6\b|아이오닉\s*6)/i.test(identity)) return false;
  if (/^(?:kia|기아)$/i.test(make) && /(?:\bK9\b|\bK900\b|\bQuoris\b|퀴리스)/i.test(identity)) return false;
  return true;
}

export function isCatalogKnownK9EngineSemanticValid(offer: VehicleOffer) {
  if (clean(offer.market).toLowerCase() !== "korea") return true;
  const raw = (offer.operational as any)?.raw || {};
  const identity = [offer.make, offer.model, offer.trim, offer.sourceTitle, JSON.stringify(raw)].map(clean).filter(Boolean).join(" ");
  if (!/(?:\bk9\b|k900|quoris|퀴리스)/i.test(identity)) return true;
  const isThreeThreeGdi = /(?:\b3[.,]3\b[^\n]{0,40}\bgdi\b|\bgdi\b[^\n]{0,40}\b3[.,]3\b)/i.test(identity);
  if (!isThreeThreeGdi) return true;
  const engineCc = Number(offer.engineCc || 0);
  if ([3000, 3300].includes(engineCc)) return false;
  const exact3342Evidence = /(?:\b3342\b|\b3,342\b|\b3\.342\b)/i.test(identity);
  if (exact3342Evidence && engineCc !== 3342) return false;
  return true;
}

export function isCatalogOfferBusinessLiquid(offer: VehicleOffer) {
  if (!isCatalogKnownBodySemanticValid(offer) || !isCatalogKnownK9EngineSemanticValid(offer)) return false;
  const currentYear = new Date().getFullYear();
  const year = Number(offer.year || 0);
  const powerHp = Number(offer.powerHp || 0);
  if (!year || year >= currentYear - BUSINESS_LIQUIDITY_RECENT_YEARS || !(powerHp > BUSINESS_LIQUIDITY_OLDER_MAX_POWER_HP)) return true;

  const powertrainKind = clean(offer.powertrainKind).toLowerCase();
  if (["electric", "series_hybrid", "other_hybrid"].includes(powertrainKind)) return true;
  if (ALTERNATIVE_POWERTRAIN_RE.test(clean(offer.fuel))) return true;

  return false;
}

function minimumImageCount(offer: VehicleOffer) {
  if (Number((offer as any).cardProjectionVersion || 0) >= 1) return 1;
  const configured = Number(process.env.CATALOG_REBUILD_MIN_IMAGES_PER_OFFER || process.env.CATALOG_MIN_IMAGES || 2);
  return Number.isFinite(configured) ? Math.max(1, Math.min(30, Math.round(configured))) : 2;
}

function mandatorySourcePhotoIdentityVerified(offer: VehicleOffer) {
  if (!REQUIRED_SOURCE_IDS.has(String(offer.sourceId || ""))) return true;
  const operational: any = offer.operational || {};
  const raw: any = operational.raw || {};

  if (operational.photoIdentityVerified === true
    || raw.photoIdentityVerified === true
    || raw.detailIdentityVerified === true
    || raw.listingBoundImages === true) return true;

  if (offer.sourceId === "encar_direct"
    && operational.galleryVerified === true
    && ["encar_source_urls_only", "encar_detail_only_v2", "encar_source_cover_photolist_v3"].includes(String(operational.gallerySafetyMode || ""))) return true;

  if (offer.sourceId === "jpauc_japan_past_open"
    && operational.historicalAuction === true
    && Number(operational.minimumImages || 0) === 3
    && String(raw?.dataId || "") === String(offer.sourceOfferId || "")) return true;

  return false;
}

function credibleCoreContent(offer: VehicleOffer, checkSourcePolicy = true) {
  const year = Number(offer.year || 0);
  const title = listingTitle(offer);
  if (checkSourcePolicy && !isCatalogMarketSourceAllowed(offer)) return false;
  if (!hasCredibleCatalogIdentity(offer)) return false;
  if (isEncarNonCashContractOffer(offer)) return false;
  if (!meaningfulTitle(title)) return false;
  if (!isCatalogYearAllowed(year, offer.market)) return false;
  // Year gates define admission (Japan 2010+, other markets 2020+). The old
  // business-liquidity rule silently rejected otherwise valid older ICE cars
  // above 160 hp, contradicting that contract. Keep only semantic safety here;
  // price/power/age preference belongs to ordering, not publication eligibility.
  if (!isCatalogKnownBodySemanticValid(offer) || !isCatalogKnownK9EngineSemanticValid(offer)) return false;
  if (!sourcePriceOk(offer) || !mileageOk(offer)) return false;
  if (isNonPassengerCatalogBodyType(offer.bodyType)) return false;
  if (NON_VEHICLE_RE.test([title, offer.make, offer.model, offer.trim, offer.bodyType].map(clean).join(" "))) return false;
  return credibleCatalogImages(offer.images || []).length >= minimumImageCount(offer);
}

export function hasCredibleOfferContent(offer: VehicleOffer) {
  return credibleCoreContent(offer)
    && /^https?:\/\//i.test(clean(offer.operational?.sourceUrl))
    && mandatorySourcePhotoIdentityVerified(offer);
}

export function isCrediblePublicOffer(offer: VehicleOffer) {
  return offer.status === "active" && credibleCoreContent(offer, false);
}
