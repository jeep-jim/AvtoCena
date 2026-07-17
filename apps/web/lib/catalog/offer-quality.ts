import type { CatalogImage, VehicleOffer } from "./types";

const GENERIC_LISTING_RE = /(?:exclusively\s+on|read\s+more|learn\s+more|breaking\s+news|latest\s+news|car\s+news|review|road\s+test|video|article|blog|magazine|blink(?:t|en)?|toonaan|deze\s+elektr|alle\s+[a-z].*['’]s|未上传图片|暂无图片|扫码|二维码|联系卖家)/i;
const NON_VEHICLE_RE = /(?:motorcycle|motorbike|scooter|forklift|excavator|bulldozer|tractor|crane|generator|boat|ship|machinery|spare\s+parts?|engine\s+only|автозапчаст|мотоцикл|погрузчик|генератор)/i;
const PREMIUM_MAKES = /^(?:Bentley|BMW|Mercedes-Benz|Mercedes Benz|Audi|Lexus|Porsche|Land Rover|Range Rover|Maserati|Ferrari|Lamborghini|Rolls-Royce|Aston Martin)$/i;

function clean(value: unknown) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function meaningfulName(value: unknown) {
  const text = clean(value);
  if (text.length < 2 || text.length > 90) return false;
  if (/^[\d\W_]+$/u.test(text)) return false;
  if (GENERIC_LISTING_RE.test(text) || NON_VEHICLE_RE.test(text)) return false;
  return true;
}

export function credibleCatalogImages(images: CatalogImage[]) {
  const unique = new Map<string, CatalogImage>();
  for (const image of images || []) {
    if (!image?.url || Number(image.size || 0) < 12_000) continue;
    const width = Number(image.width || 0);
    const height = Number(image.height || 0);
    if (width && height) {
      const ratio = width / height;
      if (width < 420 || height < 240 || ratio < 1.08 || ratio > 2.65) continue;
    }
    const key = image.checksum || image.id || image.url;
    if (!unique.has(key)) unique.set(key, image);
  }
  return [...unique.values()];
}

export function isCrediblePublicOffer(offer: VehicleOffer) {
  if (offer.status !== "active") return false;
  if (!meaningfulName(offer.make) || !meaningfulName(offer.model)) return false;

  const text = [offer.make, offer.model, offer.trim, offer.operational?.sourceVenueName].map(clean).filter(Boolean).join(" ");
  if (GENERIC_LISTING_RE.test(text) || NON_VEHICLE_RE.test(text)) return false;

  const year = Number(offer.year || 0);
  const currentYear = new Date().getFullYear();
  if (year < 1990 || year > currentYear + 1) return false;

  const totalRub = Number(offer.totalRub || 0);
  if (!Number.isFinite(totalRub) || totalRub < 250_000 || totalRub > 150_000_000) return false;
  if (year >= currentYear - 6 && totalRub < 650_000) return false;
  if (PREMIUM_MAKES.test(clean(offer.make)) && year >= 2015 && totalRub < 1_000_000) return false;

  const images = credibleCatalogImages(offer.images || []);
  const strictSource = /(?:_open|jpauc|che168|autohome|tcv|japan_partner|gaspedaal|otomoto|standvirtual|autoscout|mobile_de)/i.test(offer.sourceId || "");
  if (!images.length) return false;
  if (strictSource && offer.market !== "uae" && images.length < 2) return false;

  return true;
}
