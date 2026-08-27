import type { CatalogImage, VehicleOffer } from "./types";
import { catalogImageScore, isLikelyVehicleImage } from "./image-quality";
import { REQUIRED_CATALOG_SOURCES, isAllowedCatalogSourceId, isAllowedCatalogSourceUrl } from "./required-catalog-sources";
import { isEncarNonCashContractOffer } from "./encar-sale-contract";

const GENERIC_LISTING_RE = /(?:exclusively\s+on|read\s+more|learn\s+more|breaking\s+news|latest\s+news|car\s+news|road\s+test|article|blog|magazine|toonaan|deze\s+elektr|highly\s+responsive|certified\s+pre\s+owned|\b(?:aed|usd|eur)\s*\d+\s*\/\s*month\b|\b0\s*dp\b|\b\d+\s*day\s*return\b|\breturn\s+warranty\b|^location$|^alle\s+|未上传图片|暂无图片|扫码|二维码|联系卖家|&(?:#\d+|[a-z]+);)/i;
const NON_VEHICLE_RE = /(?:motorcycle|motorbike|scooter|jet\s*ski|watercraft|personal\s+watercraft|super\s+jet|forklift|excavator|bulldozer|tractor|crane|generator|boat|ship|machinery|spare\s+parts?|engine\s+only|автозапчаст|мотоцикл|погрузчик|генератор)/i;
const NON_PASSENGER_BODY_RE = /^(?:truck|light[\s-]*truck|heavy[\s-]*truck|lorry|commercial(?:\s+vehicle)?|bus|coach|special(?:\s+purpose)?(?:\s+vehicle)?|machinery)$/i;
const BAD_IMAGE_RE = /(?:no[-_ ]?photo|no[-_ ]?image|nophoto|noimage|image[-_ ]?not[-_ ]?available|coming[-_ ]?soon|default[-_ ]?(?:car|vehicle|image)|upload[-_ ]?image|placeholder|qrcode|qr-code|qr_|weixin|wechat|scan|download[-_ ]?app|appstore|googleplay|favicon|sprite|tracking|pixel|social|share[-_ ]?icon|camera[-_ ]?off|dummy[-_ ]?(?:car|image)|\/users\/|cdn-cgi|challenge-platform)/i;
const ALTERNATIVE_POWERTRAIN_RE = /(?:hybrid|phev|hev|electric|\bbev\b|\bev\b|гибрид|электро)/i;
const INVALID_CATALOG_IDENTITY_RE = /^(?:unknown|undefined|null|none|n\/?a|not\s+(?:specified|available|known)|other(?:s)?|andere|brand|make|model|марка(?:\s+уточняется)?|модель(?:\s+уточняется)?|уточняется|не\s+указано|неизвестно|기타|미상|其他|未知|その他)$/iu;
const REQUIRED_SOURCE_IDS = new Set(Object.values(REQUIRED_CATALOG_SOURCES).flat().map((source) => source.sourceId));
const BUSINESS_LIQUIDITY_RECENT_YEARS = 5;
const BUSINESS_LIQUIDITY_OLDER_MAX_POWER_HP = 160;
const CARUSED_IMAGE_HOST = "d1og64tg0ubvon.cloudfront.net";
const GOONET_CATALOG_IMAGE_HOST = "catalogphoto.goo-net.com";
const GOONET_PICTURE_HOST_RE = /(?:^|\.)picture\d*\.goo-net\.com$/i;
export const CATALOG_NON_JAPAN_MIN_YEAR = 2020;
export const CATALOG_JAPAN_MIN_YEAR = 2010;

export function isCatalogMarketSourceAllowed(offer: Pick<VehicleOffer, "market" | "sourceId">) {
  return isAllowedCatalogSourceId(offer.market, offer.sourceId);
}

export function hasAllowedCatalogSourceProvenance(offer: VehicleOffer) {
  return isCatalogMarketSourceAllowed(offer)
    && isAllowedCatalogSourceUrl(offer.market, offer.sourceId, offer.operational?.sourceUrl);
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

function coherentCarusedImages(input: CatalogImage[]) {
  const groups = new Map<string, Map<string, { frame: number; image: CatalogImage }>>();
  let sawCarused = false;
  for (const image of input || []) {
    try {
      const url = new URL(String(image?.url || "").replace(/&amp;/g, "&"));
      if (url.hostname.toLowerCase() !== CARUSED_IMAGE_HOST) continue;
      const match = url.pathname.match(/^\/refno-cars\/(?:[^/]+\/)+(\d+)\/(\d+)\.(?:jpe?g|png|webp|avif)$/i);
      if (!match) continue;
      sawCarused = true;
      url.searchParams.delete("w");
      const group = match[1];
      const frame = Number(match[2]);
      if (!groups.has(group)) groups.set(group, new Map());
      const bucket = groups.get(group)!;
      if (!bucket.has(url.pathname)) bucket.set(url.pathname, { frame, image: { ...image, url: url.toString() } });
    } catch { /* ignore non-source URLs */ }
  }
  if (!sawCarused) return null;
  const ranked = [...groups.entries()].sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]));
  if (!ranked.length) return [];
  if (ranked[1] && ranked[1][1].size === ranked[0][1].size) return [];
  return [...ranked[0][1].values()].sort((a, b) => a.frame - b.frame).map((row) => row.image);
}

function coherentGoonetImages(input: CatalogImage[]) {
  const exactGroups = new Map<string, Map<string, { frame: number; image: CatalogImage }>>();
  const pageGroups = new Map<string, Map<string, { frame: number; image: CatalogImage }>>();
  let sawGoonet = false;
  for (const image of input || []) {
    try {
      const url = new URL(String(image?.url || "").replace(/&amp;/g, "&"));
      const host = url.hostname.toLowerCase();
      if (host !== GOONET_CATALOG_IMAGE_HOST && !GOONET_PICTURE_HOST_RE.test(host)) continue;
      sawGoonet = true;
      if (!GOONET_PICTURE_HOST_RE.test(host)) continue;

      const exact = url.pathname.match(/\/J\/(\d{21})(\d{2})\.(?:jpe?g|png|webp|avif)$/i);
      if (exact) {
        const listingId = exact[1];
        const frame = Number(exact[2]);
        if (!exactGroups.has(listingId)) exactGroups.set(listingId, new Map());
        const bucket = exactGroups.get(listingId)!;
        if (!bucket.has(url.pathname)) bucket.set(url.pathname, { frame, image });
        continue;
      }

      const pageFrame = url.pathname.match(/\/J\/([A-Z0-9]{12,})(\d{2})\.(?:jpe?g|png|webp|avif)$/i);
      if (!pageFrame || !/[A-Z]/i.test(pageFrame[1])) continue;
      const family = pageFrame[1].toUpperCase();
      const frame = Number(pageFrame[2]);
      if (!pageGroups.has(family)) pageGroups.set(family, new Map());
      const bucket = pageGroups.get(family)!;
      if (!bucket.has(url.pathname)) bucket.set(url.pathname, { frame, image });
    } catch { /* ignore non-source URLs */ }
  }
  if (!sawGoonet) return null;
  if (exactGroups.size > 1) return [];

  const exactRows = exactGroups.size === 1
    ? [...[...exactGroups.values()][0].values()].sort((a, b) => a.frame - b.frame)
    : [];
  const exactCover = exactRows.find((row) => row.frame === 0);
  if (exactRows.length >= 2 && exactCover) return exactRows.map((row) => row.image);

  const rankedPageGroups = [...pageGroups.entries()].sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]));
  if (!rankedPageGroups.length || rankedPageGroups[0][1].size < 2) return [];
  if (rankedPageGroups[1] && rankedPageGroups[1][1].size === rankedPageGroups[0][1].size) return [];
  const pageRows = [...rankedPageGroups[0][1].values()].sort((a, b) => a.frame - b.frame);
  if (!pageRows.some((row) => row.frame === 1)) return [];
  return [
    ...(exactCover ? [exactCover.image] : []),
    ...pageRows.map((row) => row.image),
  ];
}

export function credibleCatalogImages(images: CatalogImage[]) {
  const carused = coherentCarusedImages(images || []);
  let candidates = carused === null ? (images || []) : carused;
  const goonet = coherentGoonetImages(candidates);
  if (goonet !== null) candidates = goonet;
  const unique = new Map<string, CatalogImage>();
  for (const image of candidates) {
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
  const configuredValue = process.env.CATALOG_REBUILD_MIN_IMAGES_PER_OFFER || process.env.CATALOG_MIN_IMAGES;
  if (configuredValue) {
    const configured = Number(configuredValue);
    return Number.isFinite(configured) ? Math.max(1, Math.min(30, Math.round(configured))) : 1;
  }
  if (offer.market === "georgia") return 5;
  if (offer.market === "korea") return 5;
  if (["autohome_new_china_open", "mobile_de_open"].includes(String(offer.sourceId || ""))) return 5;
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

  if (offer.sourceId === "encar_direct"
    && operational.galleryVerified === true
    && ["encar_source_urls_only", "encar_detail_only_v2", "encar_source_cover_photolist_v3"].includes(String(operational.gallerySafetyMode || ""))) return true;

  if (offer.sourceId === "jpauc_japan_past_open"
    && operational.historicalAuction === true
    && Number(operational.minimumImages || 0) === 3
    && String(raw?.dataId || "") === String(offer.sourceOfferId || "")) return true;

  return false;
}

function credibleCoreContent(offer: VehicleOffer, checkSourcePolicy = true, checkGalleryCoherence = true) {
  const year = Number(offer.year || 0);
  const title = listingTitle(offer);
  if (checkSourcePolicy && !isCatalogMarketSourceAllowed(offer)) return false;
  if (!hasCredibleCatalogIdentity(offer)) return false;
  if (isEncarNonCashContractOffer(offer)) return false;
  if (!meaningfulTitle(title)) return false;
  if (!isCatalogYearAllowed(year, offer.market)) return false;
  if (!isCatalogKnownBodySemanticValid(offer) || !isCatalogKnownK9EngineSemanticValid(offer)) return false;
  if (!sourcePriceOk(offer) || !mileageOk(offer)) return false;
  if (isNonPassengerCatalogBodyType(offer.bodyType)) return false;
  if (NON_VEHICLE_RE.test([title, offer.make, offer.model, offer.trim, offer.bodyType].map(clean).join(" "))) return false;
  if (!checkGalleryCoherence) {
    return (offer.images || []).some((image) => {
      const url = String(image?.url || image?.objectKey || "");
      return Boolean(url) && !BAD_IMAGE_RE.test(url) && isLikelyVehicleImage(image);
    });
  }
  return credibleCatalogImages(offer.images || []).length >= minimumImageCount(offer);
}

export function hasCredibleOfferContent(offer: VehicleOffer) {
  return hasAllowedCatalogSourceProvenance(offer)
    && credibleCoreContent(offer, false)
    && mandatorySourcePhotoIdentityVerified(offer);
}

export function isCrediblePublicOffer(offer: VehicleOffer) {
  if (offer.status !== "active" || !hasAllowedCatalogSourceProvenance(offer)) return false;
  const compactProjection = Number((offer as any).cardProjectionVersion || 0) >= 1;
  if (compactProjection) return credibleCoreContent(offer, false, false);
  return credibleCoreContent(offer, false);
}


/**
 * Public search projections are attested while the complete source offer is in
 * memory. V3 deliberately omits private provenance and raw source payloads, so
 * public pages must validate the attestation instead of rerunning full-source
 * quality checks against a compact card row.
 */
export function isRenderablePublicCatalogOffer(offer: VehicleOffer | any) {
  if (Number(offer?.cardProjectionVersion || 0) >= 3) {
    return offer?.publicSpecificationVerified === true
      && Number(offer?.publicVisibleRub || 0) > 0;
  }
  return isCrediblePublicOffer(offer as VehicleOffer);
}
