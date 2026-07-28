import type { CatalogImage, VehicleOffer } from "./types";
import { isLikelyVehicleImage } from "./image-quality";

const GENERIC_LISTING_RE = /(?:exclusively\s+on|read\s+more|learn\s+more|breaking\s+news|latest\s+news|car\s+news|road\s+test|article|blog|magazine|toonaan|deze\s+elektr|highly\s+responsive|certified\s+pre\s+owned|^location$|^alle\s+|未上传图片|暂无图片|扫码|二维码|联系卖家|&(?:#\d+|[a-z]+);)/i;
const NON_VEHICLE_RE = /(?:motorcycle|motorbike|scooter|forklift|excavator|bulldozer|tractor|crane|generator|boat|ship|machinery|spare\s+parts?|engine\s+only|автозапчаст|мотоцикл|погрузчик|генератор)/i;
const BAD_IMAGE_RE = /(?:no[-_ ]?photo|no[-_ ]?image|nophoto|noimage|image[-_ ]?not[-_ ]?available|coming[-_ ]?soon|default[-_ ]?(?:car|vehicle|image)|upload[-_ ]?image|placeholder|qrcode|qr-code|qr_|weixin|wechat|scan|download[-_ ]?app|appstore|googleplay|favicon|sprite|tracking|pixel|twitter|x\.com|social|share[-_ ]?icon|repair|maintenance|wrench|spanner|tool[-_ ]?icon|service[-_ ]?icon|camera[-_ ]?off|car[-_ ]?silhouette|dummy[-_ ]?(?:car|image))/i;
const DISALLOWED_GENERIC_SOURCES = new Set(["dubicars_uae", "dubicars_clean", "autouncle_europe", "autoscout_europe"]);
const EXOTIC_MAKES = /(?:ferrari|lamborghini|rolls[- ]?royce|bentley|mclaren|aston martin|bugatti|pagani|koenigsegg)/i;
const PERFORMANCE_RE = /(?:amg|brabus|alpina|maybach|m[2-8]\b|rs\s?[3-7]\b|gt\b|gts\b|turbo s|hellcat|svr|type r|nismo|grmn|superleggera|competizione)/i;
const COMMERCIAL_RE = /(?:hino|isuzu|fuso|canter|profi?a|truck|lorry|cargo|flatbed|tipper|dump|tractor unit|тягач|грузовик|самосвал|бортовой)/i;
const REQUIRED_PRICE_LINES = [
  "car",
  "topavto-commission",
  "broker",
  "svh",
  "laboratory",
  "sbkts",
  "epts",
  "rf-delivery",
  "customs",
];

function clean(value: unknown) { return String(value || "").replace(/\s+/g, " ").trim(); }
function meaningfulName(value: unknown) {
  const text = clean(value);
  if (text.length < 1 || text.length > 140) return false;
  if (!/[\p{L}\p{N}]/u.test(text)) return false;
  if (GENERIC_LISTING_RE.test(text) || NON_VEHICLE_RE.test(text)) return false;
  return true;
}
function imageIdentity(image: CatalogImage) { return String(image.checksum || image.id || image.objectKey || image.url || ""); }

export function credibleCatalogImages(images: CatalogImage[]) {
  const unique = new Map<string, CatalogImage>();
  for (const image of images || []) {
    const url = String(image?.url || image?.objectKey || "");
    if (!image || !url || BAD_IMAGE_RE.test(url) || !isLikelyVehicleImage(image)) continue;
    const size = Number(image.size || 0);
    if (size > 0 && size < 4_000) continue;
    const width = Number(image.width || 0);
    const height = Number(image.height || 0);
    if (width > 0 && height > 0) {
      const ratio = width / height;
      if (width < 420 || height < 260 || ratio < 1.08 || ratio > 2.2) continue;
    }
    const key = imageIdentity(image);
    if (key && !unique.has(key)) unique.set(key, image);
  }
  return [...unique.values()];
}

function vehicleText(offer: VehicleOffer) {
  return [offer.make, offer.model, offer.trim, offer.bodyType, offer.operational?.sourceVenueName]
    .map(clean)
    .filter(Boolean)
    .join(" ");
}

function hasPlausibleSourcePrice(offer: VehicleOffer) {
  const sourcePrice = Number(offer.sourcePrice || 0);
  const currency = clean(offer.sourceCurrency).toUpperCase();
  if (!Number.isFinite(sourcePrice) || sourcePrice <= 0 || !currency) return false;
  const description = vehicleText(offer);
  const exceptional = EXOTIC_MAKES.test(offer.make) || PERFORMANCE_RE.test(description) || COMMERCIAL_RE.test(description);
  const limits: Record<string, [number, number, number]> = {
    JPY: [30_000, 200_000_000, 40_000_000],
    KRW: [300_000, 1_500_000_000, 400_000_000],
    CNY: [5_000, 10_000_000, 2_500_000],
    RMB: [5_000, 10_000_000, 2_500_000],
    AED: [2_000, 10_000_000, 2_500_000],
    USD: [500, 2_000_000, 350_000],
    EUR: [500, 2_000_000, 350_000],
    GBP: [500, 2_000_000, 350_000],
    CHF: [500, 2_000_000, 350_000],
    PLN: [2_000, 8_000_000, 1_500_000],
    GEL: [1_000, 5_000_000, 1_000_000],
    KGS: [20_000, 200_000_000, 50_000_000],
  };
  const [minimum, exceptionalMaximum, regularMaximum] = limits[currency] || [1, 1_000_000_000, 100_000_000];
  return sourcePrice >= minimum && sourcePrice <= (exceptional ? exceptionalMaximum : regularMaximum);
}

function hasPlausiblePrice(offer: VehicleOffer) {
  const totalRub = Number(offer.totalRub || 0);
  if (!totalRub || !hasPlausibleSourcePrice(offer)) return false;
  const year = Number(offer.year || 0);
  const description = vehicleText(offer);
  const exotic = EXOTIC_MAKES.test(offer.make);
  const commercial = COMMERCIAL_RE.test(description);
  if (totalRub < 120_000 || totalRub > 180_000_000) return false;
  if (year >= 2022 && totalRub < 900_000) return false;
  if (year >= 2018 && totalRub < 500_000) return false;
  if (totalRub > 50_000_000 && !exotic && !commercial) return false;
  return true;
}

function hasPlausibleSpecs(offer: VehicleOffer) {
  const description = vehicleText(offer);
  const performance = EXOTIC_MAKES.test(offer.make) || PERFORMANCE_RE.test(description);
  const commercial = COMMERCIAL_RE.test(description);
  const engineCc = Number(offer.engineCc || 0);
  const powerHp = Number(offer.powerHp || 0);
  const powerKw = Number(offer.powerKw || 0);

  if (engineCc && (!Number.isFinite(engineCc) || engineCc < 300 || engineCc > (commercial ? 18_000 : 8_000))) return false;
  if (!Number.isFinite(powerHp) || powerHp < 20 || powerHp > (performance || commercial ? 1_500 : 650)) return false;
  if (engineCc && !performance && !commercial && powerHp / engineCc > 0.21) return false;
  if (powerKw > 0) {
    const hpFromKw = powerKw * 1.35962;
    const delta = Math.abs(hpFromKw - powerHp) / Math.max(powerHp, hpFromKw);
    if (delta > 0.4) return false;
  }
  return true;
}

function hasReadyCalculation(offer: VehicleOffer) {
  if (!["ready", "estimated", "auction_start"].includes(String(offer.calculationStatus || ""))) return false;
  const customs = offer.calculationSnapshot?.customs;
  return !customs || customs.status === "ready";
}

function hasCompletePriceBreakdown(offer: VehicleOffer) {
  const rows = Array.isArray(offer.calculationSnapshot?.breakdown)
    ? offer.calculationSnapshot.breakdown
    : [];
  const positiveIds = new Set(rows
    .filter((line: any) => Number(line?.amountRub || 0) > 0)
    .map((line: any) => String(line?.id || "")));
  return REQUIRED_PRICE_LINES.every((id) => positiveIds.has(id));
}

function hasMileage(offer: VehicleOffer) {
  if (offer.mileageKm === undefined || offer.mileageKm === null) return true;
  const mileage = Number(offer.mileageKm);
  return Number.isFinite(mileage) && mileage >= 0 && mileage <= 5_000_000;
}

function hasRequiredPower(offer: VehicleOffer) {
  if (!(Number(offer.powerHp || 0) > 0)) return false;
  const kind = String(offer.powertrainKind || "");
  if (["electric", "series_hybrid", "other_hybrid"].includes(kind)) {
    const exact = Number(offer.power30MinKw || 0) > 0 && Number(offer.utilizationPowerKw || 0) > 0;
    const explicitPreview = offer.calculationStatus === "estimated"
      && offer.calculationSnapshot?.certified30MinutePowerMissing === true
      && Number(offer.utilizationPowerKw || 0) > 0;
    return exact || explicitPreview;
  }
  return true;
}

function rawImageUrls(offer: VehicleOffer) {
  const raw = offer.operational?.raw as any;
  const candidateFields = [raw?.images, raw?.photos, raw?.gallery, raw?.imageUrls, raw?.photoUrls];
  return candidateFields.flatMap((field) => Array.isArray(field) ? field : [])
    .map((value: any) => typeof value === "string" ? value : value?.url || value?.src || value?.large || value?.original || "")
    .map(String)
    .filter(Boolean);
}

function rawImagesAreCredible(offer: VehicleOffer) {
  const rawImages = rawImageUrls(offer);
  if (rawImages.length && !rawImages.some((url: string) => !BAD_IMAGE_RE.test(url))) return false;
  if (String(offer.sourceId || "").endsWith("_open")) {
    const credibleCount = credibleCatalogImages(offer.images || []).length;
    const boundCount = Number((offer.operational as any)?.gallerySourceImageCount || rawImages.length || 0);
    if (!boundCount || credibleCount > boundCount) return false;
  }
  return true;
}

function hasCredibleListingCore(offer: VehicleOffer) {
  const sourceId = String(offer.sourceId || "");
  if (DISALLOWED_GENERIC_SOURCES.has(sourceId)) return false;
  const raw = offer.operational?.raw as any;
  const rawImages = Array.isArray(raw?.images) ? raw.images.map(String).filter(Boolean) : [];
  if (sourceId === "dubicars_uae_exact" && rawImages.length && !rawImages.some((url: string) => /\/images\/[a-f0-9]{6}\/(?:w_?\d+x\d+|\d+x\d+)\/[^/?#]+\/[a-f0-9-]+\.(?:jpe?g|webp)/i.test(url))) return false;
  if (!meaningfulName(offer.make) || !meaningfulName(offer.model)) return false;
  const combinedText = vehicleText(offer);
  if (GENERIC_LISTING_RE.test(combinedText) || NON_VEHICLE_RE.test(combinedText)) return false;
  const year = Number(offer.year || 0);
  const currentYear = new Date().getFullYear();
  if (year < 1985 || year > currentYear + 1) return false;
  if (!hasMileage(offer)
    || !offer.operational?.sourceUrl
    || !hasPlausibleSourcePrice(offer)
    || !rawImagesAreCredible(offer)) return false;
  const requiredImages = Math.max(1, Number(process.env.CATALOG_REBUILD_MIN_IMAGES_PER_OFFER || 1));
  return credibleCatalogImages(offer.images || []).length >= requiredImages;
}

function hasPendingCalculation(offer: VehicleOffer) {
  const status = String(offer.calculationStatus || "");
  return !Number(offer.totalRub || 0) && (status === "needs_data" || status.startsWith("needs_"));
}

export function hasCredibleOfferContent(offer: VehicleOffer) {
  if (!hasCredibleListingCore(offer)) return false;
  if (hasPendingCalculation(offer)) return true;
  return hasRequiredPower(offer)
    && hasPlausibleSpecs(offer)
    && hasReadyCalculation(offer)
    && hasCompletePriceBreakdown(offer)
    && hasPlausiblePrice(offer);
}

export function isCrediblePublicOffer(offer: VehicleOffer) { return offer.status === "active" && hasCredibleOfferContent(offer); }
