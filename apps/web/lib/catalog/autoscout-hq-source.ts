import { captureSourceTable, namedTechnicalGroups } from "./source-table-capture";
import { AutoScoutEuropeExactAdapter, autoScoutSpecificationEvidence, type AutoScoutExactRow } from "./autoscout-exact-source-base";
import type { CatalogImage, VehicleOffer } from "./types";

const HEADERS = {
  accept: "text/html,application/xhtml+xml,application/json;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "accept-language": "en-GB,en;q=0.9,de;q=0.7",
  "cache-control": "no-cache",
  pragma: "no-cache",
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
};

function clean(value: unknown) { return String(value ?? "").replace(/\s+/g, " ").trim(); }

// A gallery check alone must not leave price/specifications from the search
// result in an offer marked exactDetail. Read only this listing's named data.
export function parseAutoScoutExactDetail(detail: any, sourceOfferId: string, sourceUrl: string): AutoScoutExactRow | null {
  if (!detail || clean(detail.id) !== sourceOfferId || detail.status !== "Active") return null;
  try {
    const declared = new URL(detail.webPage), expected = new URL(sourceUrl);
    if (declared.hostname !== expected.hostname || declared.pathname !== expected.pathname
      || !declared.pathname.endsWith(sourceOfferId)) return null;
  } catch { return null; }
  const vehicle = detail.vehicle;
  const price = detail.prices?.public;
  if (!vehicle || !clean(vehicle.make) || !clean(vehicle.model)
    || price?.onRequestOnly === true || detail.price?.isConditionalPrice === true
    || typeof price?.priceRaw !== "number" || !Number.isFinite(price.priceRaw) || price.priceRaw <= 0
    || !/^€\s*\d/.test(clean(price.price))) return null;
  const registration = clean(vehicle.firstRegistrationDateRaw).match(/^((?:19|20)\d{2})-(0[1-9]|1[0-2])-\d{2}$/);
  const unitValue = (value: unknown, unit: string) => typeof value === "number" && value > 0 ? `${value} ${unit}` : "";
  const semanticEvidence = autoScoutSpecificationEvidence({
    firstRegistrations: [registration ? `${registration[2]}/${registration[1]}` : "", vehicle.firstRegistrationDate],
    fuels: [vehicle.fuelCategory?.formatted],
    engineDisplacementsCcm: [vehicle.rawDisplacementInCCM, vehicle.rawCylinderCapacity, vehicle.displacementInCCM],
    power: [unitValue(vehicle.rawPowerInKw, "kW"), unitValue(vehicle.rawPowerInHp, "hp"), vehicle.powerInKw, vehicle.powerInHp],
    sourceUrl,
  });
  if (semanticEvidence.year.status !== "exact") return null;
  const trim = clean(vehicle.modelVersionInput || vehicle.variant);
  return { id: sourceOfferId, sourceUrl, make: clean(vehicle.make), model: clean(vehicle.model), trim,
    title: [vehicle.make, vehicle.model, trim].filter(Boolean).join(" "), year: semanticEvidence.year.value!,
    mileageKm: typeof vehicle.mileageInKmRaw === "number" && vehicle.mileageInKmRaw >= 0 ? vehicle.mileageInKmRaw : undefined,
    transmission: clean(vehicle.transmissionType) || undefined, drive: clean(vehicle.driveTrain) || undefined,
    bodyType: clean(vehicle.bodyType) || undefined, price: price.priceRaw, currency: "EUR",
    images: Array.isArray(detail.images) ? detail.images : [], raw: { vehicle, price }, semanticEvidence };
}

function imageResolution(url: string) {
  const match = url.match(/\/(\d{2,5})x(\d{2,5})\.(jpe?g|webp|avif|png)(?:[?#]|$)/i);
  return { width: Number(match?.[1] || 0) || undefined, height: Number(match?.[2] || 0) || undefined, extension: match?.[3]?.toLowerCase() };
}

function image(url: string): CatalogImage {
  const rendition = imageResolution(url);
  const extension = rendition.extension || "jpeg";
  return { id: "", url, objectKey: "", checksum: "", width: rendition.width, height: rendition.height, size: 0,
    mimeType: extension === "png" ? "image/png" : extension === "avif" ? "image/avif" : extension === "webp" ? "image/webp" : "image/jpeg" };
}

export function parseAutoScoutDetailGallery(markup: string, sourceOfferId: string, limit = 30) {
  const match = markup.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!match?.[1] || !sourceOfferId) return [];
  let data: any;
  try { data = JSON.parse(match[1]); } catch { return []; }
  const details = data?.props?.pageProps?.listingDetails;
  if (!details || !Array.isArray(details.images)) return [];
  const declaredId = clean(details.id || details.listingId || details.uuid);
  if (declaredId && declaredId !== sourceOfferId) return [];

  // AutoScout exposes an explicit source flag when the dealer's designated cover
  // is a placeholder/promo frame rather than a vehicle photograph. A listing can
  // still have five same-listing JPEG URLs in this state, so listing-bound identity
  // alone is not sufficient. Fail closed instead of showing the dealer artwork as
  // the customer's main vehicle photo.
  if (details.isCoverImagePlaceholder === true) return [];

  const prefix = `/listing-images/${sourceOfferId}_`.toLowerCase();
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of details.images) {
    const url = clean(value);
    if (!/^https?:\/\/prod\.pictures\.autoscout24\.net\/listing-images\//i.test(url)) continue;
    let pathname = "";
    try { pathname = new URL(url).pathname.toLowerCase(); } catch { continue; }
    const { width, height } = imageResolution(url);
    if (!pathname.startsWith(prefix) || !width || !height || width < 900 || height < 600 || seen.has(url)) continue;
    seen.add(url);
    result.push(url);
    if (result.length >= Math.min(30, Math.max(1, limit))) break;
  }
  return result;
}

export class AutoScoutHqAdapter extends AutoScoutEuropeExactAdapter {
  override normalizeOffer(raw: unknown): VehicleOffer | null {
    const offer = super.normalizeOffer(raw as AutoScoutExactRow);
    if (!offer) return null;
    offer.operational = {
      ...(offer.operational || {}), exactDetail: false, exactPhotos: false, galleryVerified: false, galleryImageCount: 0,
      gallerySafetyMode: "autoscout_exact_detail_pending_v2", photoIdentityVerified: false,
      raw: { parsed: raw, searchImages: (raw as AutoScoutExactRow).images, listingBoundSearchImages: true, photoIdentityVerified: false, detailIdentityVerified: false },
    } as any;
    return offer;
  }

  override async fetchImages(offer: VehicleOffer): Promise<CatalogImage[]> {
    const sourceOfferId = clean(offer.sourceOfferId);
    const sourceUrl = clean(offer.operational?.sourceUrl);
    if (!sourceOfferId || !sourceUrl.includes("/offers/") || !sourceUrl.includes(sourceOfferId)) return [];
    const response = await fetch(sourceUrl, { headers: HEADERS, redirect: "follow", signal: AbortSignal.timeout(Math.max(5_000, Number(process.env.CATALOG_SOURCE_REQUEST_TIMEOUT_MS || 30_000))) });
    const markup = await response.text();
    if (!response.ok) throw new Error(`autoscout_detail_http_${response.status}:${sourceOfferId}`);
    const nextScript = markup.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
    let detail: any = null;
    try { detail = JSON.parse(nextScript?.[1] || "{}").props?.pageProps?.listingDetails; } catch {}
    const detailRow = parseAutoScoutExactDetail(detail, sourceOfferId, sourceUrl);
    if (!detailRow) throw new Error(`autoscout_detail_fields_unverified:${sourceOfferId}`);
    const exact = super.normalizeOffer(detailRow);
    if (!exact) throw new Error(`autoscout_detail_fields_rejected:${sourceOfferId}`);
    for (const field of ["make", "model", "trim", "sourceTitle", "year", "mileageKm", "engineCc", "powerHp", "powerKw", "fuel", "powertrainKind",
      "transmission", "drive", "bodyType", "sourcePrice", "sourceCurrency", "powerDataConfidence", "powerDataSource"] as const) {
      (offer as any)[field] = exact[field];
    }
    offer.operational = { ...offer.operational, semanticEvidence: exact.operational?.semanticEvidence } as any;
    if (offer.powerHp || offer.powerKw) offer.powerDataSource = "AutoScout24 exact listingDetails.vehicle";
    // Fresh peak power is not certified 30-minute power; requalification must
    // decide whether this offer has sufficient evidence for a calculation.
    offer.power30MinKw = undefined;
    offer.power30MinKwByMotor = undefined;
    offer.utilizationPowerKw = undefined;
    offer.calculationSnapshot = undefined;
    offer.totalRub = null;
    offer.calculationStatus = "needs_data";
    if (detail && clean(detail.id || detail.listingId || detail.uuid) === sourceOfferId) {
      captureSourceTable(offer, [
        ...namedTechnicalGroups(detail.vehicle || detail.vehicleDetails, "Автомобиль"),
        ...namedTechnicalGroups(detail.attributes || detail.technicalData || detail.specifications, "Технические характеристики"),
        ...namedTechnicalGroups(detail.equipment || detail.equipmentCategories || detail.features, "Оснащение"),
      ]);
    }
    const urls = parseAutoScoutDetailGallery(markup, sourceOfferId, Math.min(30, Math.max(5, Number(process.env.CATALOG_MAX_IMAGES_PER_OFFER || 30))));
    if (urls.length < 5) return [];
    const previousRaw = offer.operational?.raw && typeof offer.operational.raw === "object" ? offer.operational.raw as Record<string, unknown> : {};
    offer.operational = {
      ...(offer.operational || {}), exactDetail: true, exactPhotos: true, galleryVerified: true, galleryImageCount: urls.length,
      gallerySafetyMode: "autoscout_exact_detail_next_gallery_v2", galleryStoredAs: "json_urls", photoIdentityVerified: true, photoResolutionVerified: true,
      raw: { ...previousRaw, parsed: detailRow, detailImages: urls, listingBoundImages: true, photoIdentityVerified: true, photoResolutionVerified: true, detailIdentityVerified: true },
    } as any;
    return urls.map(image);
  }
}

export const autoscoutEuropeHqSource = new AutoScoutHqAdapter();
