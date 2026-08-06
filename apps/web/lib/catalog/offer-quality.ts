import type { CatalogImage, VehicleOffer } from "./types";
import { isLikelyVehicleImage } from "./image-quality";

const GENERIC_LISTING_RE = /(?:exclusively\s+on|read\s+more|learn\s+more|breaking\s+news|latest\s+news|car\s+news|road\s+test|article|blog|magazine|toonaan|deze\s+elektr|highly\s+responsive|certified\s+pre\s+owned|^location$|^alle\s+|未上传图片|暂无图片|扫码|二维码|联系卖家|&(?:#\d+|[a-z]+);)/i;
const NON_VEHICLE_RE = /(?:motorcycle|motorbike|scooter|forklift|excavator|bulldozer|tractor|crane|generator|boat|ship|machinery|spare\s+parts?|engine\s+only|автозапчаст|мотоцикл|погрузчик|генератор)/i;
const BAD_IMAGE_RE = /(?:no[-_ ]?photo|no[-_ ]?image|nophoto|noimage|image[-_ ]?not[-_ ]?available|coming[-_ ]?soon|default[-_ ]?(?:car|vehicle|image)|upload[-_ ]?image|placeholder|qrcode|qr-code|qr_|weixin|wechat|scan|download[-_ ]?app|appstore|googleplay|favicon|sprite|tracking|pixel|social|share[-_ ]?icon|camera[-_ ]?off|dummy[-_ ]?(?:car|image))/i;

function clean(value: unknown) { return String(value || "").replace(/\s+/g, " ").trim(); }
function meaningfulName(value: unknown) {
  const text = clean(value);
  return text.length > 0 && text.length <= 140 && /[\p{L}\p{N}]/u.test(text) && !GENERIC_LISTING_RE.test(text) && !NON_VEHICLE_RE.test(text);
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
  return Number.isFinite(mileage) && mileage >= 0 && mileage <= 5_000_000;
}

function credibleCoreContent(offer: VehicleOffer) {
  const currentYear = new Date().getFullYear();
  const year = Number(offer.year || 0);
  if (!meaningfulName(offer.make) || !meaningfulName(offer.model)) return false;
  if (year < 2011 || year > currentYear + 1) return false;
  if (!sourcePriceOk(offer) || !mileageOk(offer)) return false;
  if (NON_VEHICLE_RE.test([offer.make, offer.model, offer.trim, offer.bodyType].map(clean).join(" "))) return false;
  const requiredImages = Math.max(1, Number(process.env.CATALOG_REBUILD_MIN_IMAGES_PER_OFFER || 1));
  return credibleCatalogImages(offer.images || []).length >= requiredImages;
}

export function hasCredibleOfferContent(offer: VehicleOffer) {
  return credibleCoreContent(offer) && clean(offer.operational?.sourceUrl).length > 0;
}

export function isCrediblePublicOffer(offer: VehicleOffer) {
  return offer.status === "active" && credibleCoreContent(offer);
}
