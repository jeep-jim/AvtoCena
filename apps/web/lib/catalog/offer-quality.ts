import type { CatalogImage, VehicleOffer } from "./types";
import { isLikelyVehicleImage } from "./image-quality";
import { REQUIRED_CATALOG_SOURCES } from "./required-catalog-sources";

const GENERIC_LISTING_RE = /(?:exclusively\s+on|read\s+more|learn\s+more|breaking\s+news|latest\s+news|car\s+news|road\s+test|article|blog|magazine|toonaan|deze\s+elektr|highly\s+responsive|certified\s+pre\s+owned|\b(?:aed|usd|eur)\s*\d+\s*\/\s*month\b|\b0\s*dp\b|\b\d+\s*day\s*return\b|\breturn\s+warranty\b|^location$|^alle\s+|未上传图片|暂无图片|扫码|二维码|联系卖家|&(?:#\d+|[a-z]+);)/i;
const NON_VEHICLE_RE = /(?:motorcycle|motorbike|scooter|forklift|excavator|bulldozer|tractor|crane|generator|boat|ship|machinery|spare\s+parts?|engine\s+only|автозапчаст|мотоцикл|погрузчик|генератор)/i;
const BAD_IMAGE_RE = /(?:no[-_ ]?photo|no[-_ ]?image|nophoto|noimage|image[-_ ]?not[-_ ]?available|coming[-_ ]?soon|default[-_ ]?(?:car|vehicle|image)|upload[-_ ]?image|placeholder|qrcode|qr-code|qr_|weixin|wechat|scan|download[-_ ]?app|appstore|googleplay|favicon|sprite|tracking|pixel|social|share[-_ ]?icon|camera[-_ ]?off|dummy[-_ ]?(?:car|image)|auction[-_ ]?sheet|inspection[-_ ]?sheet|diagram)/i;
const UNKNOWN_MODEL_RE = /^(?:other|unknown|неизвестно|прочее|автомобиль|vehicle)$/i;
const REQUIRED_SOURCE_IDS = new Set(Object.values(REQUIRED_CATALOG_SOURCES).flat().map((source) => source.sourceId));

function clean(value: unknown) { return String(value || "").replace(/\s+/g, " ").trim(); }
function positive(value: unknown) { const n = Number(value); return Number.isFinite(n) && n > 0 ? n : 0; }
function meaningfulTitle(value: unknown) {
  const text = clean(value);
  return text.length >= 2 && text.length <= 180 && /[\p{L}\p{N}]/u.test(text) && !GENERIC_LISTING_RE.test(text) && !NON_VEHICLE_RE.test(text);
}
function meaningfulVehicleField(value: unknown) {
  const text = clean(value);
  return text.length > 0 && text.length <= 120 && !UNKNOWN_MODEL_RE.test(text) && !NON_VEHICLE_RE.test(text);
}
function imageIdentity(image: CatalogImage) { return String(image.checksum || image.id || image.objectKey || image.url || ""); }

export function credibleCatalogImages(images: CatalogImage[]) {
  const unique = new Map<string, CatalogImage>();
  for (const image of images || []) {
    const url = String(image?.url || image?.objectKey || "");
    if (!image || !url || BAD_IMAGE_RE.test(url) || !isLikelyVehicleImage(image)) continue;
    const key = imageIdentity(image);
    if (key && !unique.has(key)) unique.set(key, image);
    if (unique.size >= 30) break;
  }
  return [...unique.values()];
}

function sourcePriceOk(offer: VehicleOffer) {
  const price = Number(offer.sourcePrice || 0);
  return Number.isFinite(price) && price > 0 && clean(offer.sourceCurrency).length > 0;
}

function mileageOk(offer: VehicleOffer) {
  if (offer.mileageKm === undefined || offer.mileageKm === null) return true;
  const mileage = Number(offer.mileageKm);
  return Number.isFinite(mileage) && mileage >= 0 && mileage <= 1_000_000;
}

function listingTitle(offer: VehicleOffer) {
  return clean(
    offer.sourceTitle
      || offer.operational?.sourceTitle
      || [offer.make, offer.model, offer.trim].filter(Boolean).join(" "),
  );
}

function exactIdentityVerified(offer: VehicleOffer) {
  const operational: any = offer.operational || {};
  const raw: any = operational.raw || {};
  if (!REQUIRED_SOURCE_IDS.has(String(offer.sourceId || ""))) return operational.detailIdentityVerified === true;
  return operational.detailIdentityVerified === true
    || raw.detailIdentityVerified === true;
}

function exactVehiclePhotosVerified(offer: VehicleOffer) {
  const operational: any = offer.operational || {};
  const raw: any = operational.raw || {};
  return (operational.photoIdentityVerified === true || raw.photoIdentityVerified === true)
    && (operational.vehiclePhotoVerified === true || raw.vehiclePhotoVerified === true);
}

function exactCalculationReady(offer: VehicleOffer) {
  const snapshot: any = offer.calculationSnapshot || {};
  const customs: any = snapshot.customs || {};
  const operational: any = offer.operational || {};
  const status = clean(offer.calculationStatus);
  return positive(offer.totalRub) > 0
    && ["ready", "estimated"].includes(status)
    && operational.sourceOnlyCalculation === true
    && operational.calculationInputSource === "exact_detail"
    && snapshot.sourceOnly === true
    && customs.status === "ready"
    && positive(customs.totalCustomsRub) > 0
    && clean(snapshot.pricingConfidence) !== "unavailable"
    && !snapshot.vehicleKnowledge;
}

function exactSpecsReady(offer: VehicleOffer) {
  const powertrain = clean(offer.powertrainKind);
  const electric = powertrain === "electric";
  const electrified = ["electric", "series_hybrid", "other_hybrid"].includes(powertrain);
  if (!meaningfulVehicleField(offer.make) || !meaningfulVehicleField(offer.model)) return false;
  if (!meaningfulVehicleField(offer.fuel) || !meaningfulVehicleField(offer.transmission) || !meaningfulVehicleField(offer.drive) || !meaningfulVehicleField(offer.bodyType)) return false;
  if (!positive(offer.powerHp)) return false;
  if (!electric && !positive(offer.engineCc)) return false;
  if (electrified) {
    const confidence = clean(offer.powerDataConfidence);
    if (!["source_exact", "documented"].includes(confidence)) return false;
    const motor30 = positive(offer.power30MinKw)
      || (Array.isArray(offer.power30MinKwByMotor) ? offer.power30MinKwByMotor.map(positive).reduce((sum, value) => sum + value, 0) : 0);
    if (!positive(offer.utilizationPowerKw) && !motor30) return false;
  }
  return true;
}

function credibleCoreContent(offer: VehicleOffer) {
  const currentYear = new Date().getFullYear();
  const year = Number(offer.year || 0);
  const title = listingTitle(offer);
  if (!meaningfulTitle(title)) return false;
  if (year < 2011 || year > currentYear + 1) return false;
  if (!sourcePriceOk(offer) || !mileageOk(offer)) return false;
  if (NON_VEHICLE_RE.test([title, offer.make, offer.model, offer.trim, offer.bodyType].map(clean).join(" "))) return false;
  if (!exactSpecsReady(offer)) return false;
  return credibleCatalogImages(offer.images || []).length >= 5;
}

export function hasCredibleOfferContent(offer: VehicleOffer) {
  return credibleCoreContent(offer)
    && /^https?:\/\//i.test(clean(offer.operational?.sourceUrl))
    && exactIdentityVerified(offer)
    && exactVehiclePhotosVerified(offer)
    && exactCalculationReady(offer);
}

// Public DTOs omit operational metadata. Storage/API must call hasCredibleOfferContent()
// before stripping operational fields. This lightweight check protects already-public DTOs.
export function isCrediblePublicOffer(offer: VehicleOffer) {
  const snapshot: any = offer.calculationSnapshot || {};
  return offer.status === "active"
    && credibleCoreContent(offer)
    && positive(offer.totalRub) > 0
    && ["ready", "estimated"].includes(clean(offer.calculationStatus))
    && snapshot.sourceOnly === true
    && snapshot.customs?.status === "ready";
}
