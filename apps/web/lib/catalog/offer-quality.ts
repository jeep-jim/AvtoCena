import type { CatalogImage, VehicleOffer } from "./types";

const GENERIC_LISTING_RE = /(?:exclusively\s+on|read\s+more|learn\s+more|breaking\s+news|latest\s+news|car\s+news|road\s+test|article|blog|magazine|toonaan|deze\s+elektr|highly\s+responsive|certified\s+pre\s+owned|^location$|^alle\s+|未上传图片|暂无图片|扫码|二维码|联系卖家|&(?:#\d+|[a-z]+);)/i;
const NON_VEHICLE_RE = /(?:motorcycle|motorbike|scooter|forklift|excavator|bulldozer|tractor|crane|generator|boat|ship|machinery|spare\s+parts?|engine\s+only|автозапчаст|мотоцикл|погрузчик|генератор)/i;
const BAD_IMAGE_RE = /(?:no[-_ ]?photo|no[-_ ]?image|nophoto|noimage|image[-_ ]?not[-_ ]?available|coming[-_ ]?soon|default[-_ ]?(?:car|vehicle|image)|upload[-_ ]?image|placeholder|qrcode|qr-code|qr_|weixin|wechat|scan|download[-_ ]?app|appstore|googleplay|favicon|sprite|tracking|pixel|twitter|x\.com|social|share[-_ ]?icon)/i;
const DISALLOWED_GENERIC_SOURCES = new Set(["dubicars_uae", "autouncle_europe"]);
const EXOTIC_MAKES = /(?:ferrari|lamborghini|rolls[- ]?royce|bentley|mclaren|aston martin|bugatti|pagani|koenigsegg)/i;

function clean(value: unknown) { return String(value || "").replace(/\s+/g, " ").trim(); }
function meaningfulName(value: unknown) {
  const text = clean(value);
  if (text.length < 1 || text.length > 140) return false;
  if (/^[\d\W_]+$/u.test(text)) return false;
  if (GENERIC_LISTING_RE.test(text) || NON_VEHICLE_RE.test(text)) return false;
  return true;
}
function imageIdentity(image: CatalogImage) { return String(image.checksum || image.id || image.objectKey || image.url || ""); }

export function credibleCatalogImages(images: CatalogImage[]) {
  const unique = new Map<string, CatalogImage>();
  for (const image of images || []) {
    const url = String(image?.url || image?.objectKey || "");
    if (!image || !url || BAD_IMAGE_RE.test(url)) continue;
    const size = Number(image.size || 0);
    if (size > 0 && size < 4_000) continue;
    const width = Number(image.width || 0);
    const height = Number(image.height || 0);
    if (width > 0 && height > 0) {
      const ratio = width / height;
      if (width < 280 || height < 170 || ratio < 0.72 || ratio > 3.2) continue;
    }
    const key = imageIdentity(image);
    if (key && !unique.has(key)) unique.set(key, image);
  }
  return [...unique.values()];
}

function hasPlausiblePrice(offer: VehicleOffer) {
  const totalRub = Number(offer.totalRub || 0);
  if (!totalRub) return offer.calculationStatus === "needs_data" || offer.calculationStatus === "auction_start";
  const year = Number(offer.year || 0);
  const make = clean(offer.make);
  if (totalRub < 120_000 || totalRub > 180_000_000) return false;
  if (year >= 2022 && totalRub < 900_000) return false;
  if (year >= 2018 && totalRub < 500_000) return false;
  if (totalRub > 80_000_000 && !EXOTIC_MAKES.test(make)) return false;
  const sourcePrice = Number(offer.sourcePrice || 0);
  const currency = clean(offer.sourceCurrency).toUpperCase();
  if (offer.market === "japan" && currency === "USD" && sourcePrice > 250_000) return false;
  return true;
}

function rawImagesAreCredible(offer: VehicleOffer) {
  const raw = offer.operational?.raw as any;
  const rawImages = Array.isArray(raw?.images) ? raw.images.map(String).filter(Boolean) : [];
  return !rawImages.length || rawImages.some((url: string) => !BAD_IMAGE_RE.test(url));
}

export function hasCredibleOfferContent(offer: VehicleOffer) {
  if (DISALLOWED_GENERIC_SOURCES.has(String(offer.sourceId || ""))) return false;
  if (!meaningfulName(offer.make) || !meaningfulName(offer.model)) return false;
  const combinedText = [offer.make, offer.model, offer.trim, offer.operational?.sourceVenueName].map(clean).filter(Boolean).join(" ");
  if (GENERIC_LISTING_RE.test(combinedText) || NON_VEHICLE_RE.test(combinedText)) return false;
  const year = Number(offer.year || 0);
  const currentYear = new Date().getFullYear();
  if (year < 1985 || year > currentYear + 1) return false;
  if (!hasPlausiblePrice(offer) || !rawImagesAreCredible(offer)) return false;
  return credibleCatalogImages(offer.images || []).length > 0;
}

export function isCrediblePublicOffer(offer: VehicleOffer) { return offer.status === "active" && hasCredibleOfferContent(offer); }
