import { autoPapaExactDetailFacts, autoPapaGeorgiaSource } from "./autopapa-georgia-source";
import { calculateOfferWithPreliminaryPowerPricing, isPreliminaryPowerPendingCalculation } from "./customs-pricing";
import { enrichOfferWithCertifiedPower } from "./power-reference";
import { credibleCatalogImages, isCatalogMarketSourceAllowed, isCatalogYearAllowed } from "./offer-quality";
import { myAutoListSource, myAutoProductSnapshotFromInfo, parseMyAutoListingImageUrl } from "./myauto-list-source";
import { normalizeVehicleOfferSpecs } from "./spec-normalization";
import { findVehicleModel, findVehicleVariant } from "./vehicle-knowledge";
import type { CatalogImage, CatalogSourceAdapter, VehicleOffer } from "./types";

const MYAUTO_PRODUCT_API = "https://api2.myauto.ge/en/products";
const REQUEST_HEADERS = {
  accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9,ka;q=0.8",
  "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/150 Safari/537.36",
};

type RecoverySnapshot = {
  market: "georgia";
  count: number;
  partial: boolean;
  report: {
    mode: string;
    pagesPerSource: number;
    startPage: number;
    source: GeorgiaRecoverySource;
    rawSourceCounts: Record<string, number>;
    sourceCounts: Record<string, number>;
    rejected: Record<string, number>;
    imageStats: { min: number; max: number; average: number };
    calculatedCount: number;
    preliminaryCount: number;
  };
  offers: VehicleOffer[];
};

function rawRecord(offer: VehicleOffer): Record<string, any> {
  const raw = offer.operational?.raw;
  return raw && typeof raw === "object" ? raw as Record<string, any> : {};
}

function imageRecord(url: string): CatalogImage {
  const extension = url.match(/\.(jpe?g|webp|avif|png)(?:[?#]|$)/i)?.[1]?.toLowerCase();
  return {
    id: "",
    url,
    objectKey: "",
    checksum: "",
    size: 0,
    mimeType: extension === "png" ? "image/png"
      : extension === "webp" ? "image/webp"
        : extension === "avif" ? "image/avif"
          : "image/jpeg",
  };
}

async function fetchJson(url: string) {
  const response = await fetch(url, {
    headers: REQUEST_HEADERS,
    redirect: "follow",
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error("http_" + response.status);
  return response.json() as Promise<any>;
}

async function fetchMarkup(url: string) {
  const response = await fetch(url, {
    headers: REQUEST_HEADERS,
    redirect: "follow",
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  const markup = await response.text();
  if (!response.ok) throw new Error("http_" + response.status);
  return { response, markup };
}

async function pool<T, R>(rows: T[], limit: number, worker: (row: T) => Promise<R>): Promise<R[]> {
  const result = new Array<R>(rows.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, rows.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= rows.length) return;
      result[index] = await worker(rows[index]);
    }
  }));
  return result;
}

function exactCalculation(offer: VehicleOffer) {
  const total = Number(offer.totalRub || 0);
  const customs = offer.calculationSnapshot?.customs;
  const breakdown = offer.calculationSnapshot?.breakdown;
  if (!(total > 0) || customs?.status !== "ready" || !Number.isFinite(Number(customs?.totalCustomsRub))) return false;
  if (!Array.isArray(breakdown) || !breakdown.some((line: any) => line?.id === "car") || !breakdown.some((line: any) => line?.id === "customs")) return false;
  const kind = String(offer.powertrainKind || "");
  if (!["electric", "series_hybrid", "other_hybrid"].includes(kind)) return Number(offer.engineCc || 0) > 0 && Number(offer.powerHp || 0) > 0;
  if (Number(offer.utilizationPowerKw || 0) > 0) return true;
  const motor30 = Number(offer.power30MinKw || 0) || (Array.isArray(offer.power30MinKwByMotor)
    ? offer.power30MinKwByMotor.reduce((sum, value) => sum + Math.max(0, Number(value || 0)), 0)
    : 0);
  return kind === "other_hybrid" ? motor30 > 0 && Number(offer.icePowerKw || 0) > 0 : motor30 > 0;
}

async function enrichExactVariant(offer: VehicleOffer) {
  if (Number(offer.powerHp || 0) > 0) return offer;
  const kind = String(offer.powertrainKind || "");
  if (["electric", "series_hybrid", "other_hybrid"].includes(kind)) return offer;
  const engineCc = Number(offer.engineCc || 0);
  if (!(engineCc > 0)) return offer;
  const match = await findVehicleModel(offer).catch(() => null);
  if (!match) return offer;
  const variant = await findVehicleVariant(match.model, offer).catch(() => null);
  if (!variant || !(Number(variant.powerHp) > 0) || !(Number(variant.engineCc) > 0)) return offer;
  const tolerance = Math.max(20, Number(variant.engineCcTolerance || 80));
  if (Math.abs(Number(variant.engineCc) - engineCc) > tolerance) return offer;
  return normalizeVehicleOfferSpecs({
    ...offer,
    powerHp: variant.powerHp,
    powerKw: variant.powerKw || Math.round((Number(variant.powerHp) / 1.359621617) * 10) / 10,
    fuel: offer.fuel || variant.fuel,
    transmission: offer.transmission || variant.transmission,
    drive: offer.drive || variant.drive,
    generation: offer.generation || variant.generation,
    powerDataConfidence: offer.powerDataConfidence || "reference",
    powerDataSource: offer.powerDataSource || variant.sourceUrl || variant.sourceType,
    operational: {
      ...offer.operational,
      raw: {
        ...rawRecord(offer),
        recoveryVariantId: variant.id,
        recoveryVariantSource: variant.sourceUrl || variant.sourceType,
        recoveryVariantEngineCc: variant.engineCc,
      },
    },
  });
}

async function prepareMyAuto(offer: VehicleOffer) {
  const raw = rawRecord(offer);
  const id = String(offer.sourceOfferId || "");
  const listUrls = [...new Set([...(raw.images || []), ...(raw.parsed?.images || [])].map(String))];
  const identity = listUrls.map((url) => parseMyAutoListingImageUrl(url, id)).find(Boolean);

  const payload = await fetchJson(MYAUTO_PRODUCT_API + "/" + id);
  const info = payload?.data?.info;
  if (!info || typeof info !== "object") throw new Error("myauto_product_identity");
  const snapshot = myAutoProductSnapshotFromInfo(info as Record<string, unknown>, id, identity?.photo);
  if (!snapshot) throw new Error("myauto_product_identity");
  const urls = snapshot.galleryUrls;

  return normalizeVehicleOfferSpecs({
    ...offer,
    engineCc: Number(offer.engineCc || 0) > 0 ? offer.engineCc : snapshot.engineCc,
    powerHp: Number(offer.powerHp || 0) > 0 ? offer.powerHp : snapshot.powerHp,
    images: credibleCatalogImages(urls.map(imageRecord)).slice(0, 30),
    operational: {
      ...offer.operational,
      photoIdentityVerified: true,
      galleryVerified: true,
      galleryImageCount: urls.length,
      gallerySafetyMode: identity ? "myauto_list_plus_product_exact_large_formula" : "myauto_exact_product_large_formula",
      galleryStoredAs: "json_urls",
      raw: {
        ...raw,
        images: urls,
        listingBoundImages: true,
        photoIdentityVerified: true,
        myAutoListPhotoIdentityPresent: Boolean(identity),
        myAutoProductCarId: String(info.car_id),
        myAutoProductPhoto: String(info.photo),
        myAutoProductPhotoVersion: Number(info.photo_ver),
        myAutoProductPictureCount: Number(info.pic_number),
        myAutoProductEngineCc: snapshot.engineCc || null,
        myAutoProductPowerHp: snapshot.powerHp || null,
      },
    },
  });
}

async function prepareAutoPapa(offer: VehicleOffer) {
  const id = String(offer.sourceOfferId || "");
  const detailUrl = String(offer.operational?.sourceUrl || "");
  const expectedPath = new RegExp("/" + id + "/?$");
  if (!detailUrl || !expectedPath.test(new URL(detailUrl).pathname)) throw new Error("autopapa_detail_identity");
  const detail = await fetchMarkup(detailUrl);
  if (!expectedPath.test(new URL(detail.response.url || detailUrl).pathname)) throw new Error("autopapa_redirect_identity");
  const facts = autoPapaExactDetailFacts(offer, detail.markup, detail.response.url || detailUrl);
  if (!facts) throw new Error("autopapa_detail_identity");
  const urls = facts.originals.slice(0, 30);
  if (!urls.length) throw new Error("autopapa_gallery_empty");
  if (!(Number(facts.priceUsd || 0) > 0)) throw new Error("autopapa_detail_price_missing");
  const sourceExactPowerHp = facts.powerHp;

  return normalizeVehicleOfferSpecs({
    ...offer,
    sourcePrice: facts.priceUsd,
    sourceCurrency: "USD",
    powerHp: sourceExactPowerHp || offer.powerHp,
    powerKw: sourceExactPowerHp
      ? Math.round((sourceExactPowerHp / 1.359621617) * 10) / 10
      : offer.powerKw,
    powerDataConfidence: sourceExactPowerHp ? "source_exact" : offer.powerDataConfidence,
    powerDataSource: sourceExactPowerHp ? `autopapa-detail:${id}:Power` : offer.powerDataSource,
    images: credibleCatalogImages(urls.map(imageRecord)).slice(0, 30),
    operational: {
      ...offer.operational,
      photoIdentityVerified: true,
      galleryVerified: true,
      galleryImageCount: urls.length,
      gallerySafetyMode: "autopapa_exact_detail_originals",
      galleryStoredAs: "json_urls",
      raw: {
        ...rawRecord(offer),
        images: urls,
        listingBoundImages: true,
        photoIdentityVerified: true,
        detailIdentityVerified: true,
        autoPapaDetailPriceVerified: true,
        autoPapaDetailPriceUsd: facts.priceUsd,
        autoPapaDetailPriceAuthority: facts.priceAuthority || null,
        autoPapaSellerDeclaredPriceUsd: facts.sellerDeclaredPriceUsd || null,
        autoPapaStructuredPriceUsd: facts.structuredPriceUsd || null,
        autoPapaListPriceUsd: offer.sourcePrice || null,
        autoPapaDetailPowerHp: sourceExactPowerHp || null,
      },
    },
  });
}

async function collectPages(source: CatalogSourceAdapter, pages: number, startPage: number) {
  const offers = new Map<string, VehicleOffer>();
  let cursor: string | null = String(startPage);
  for (let pageIndex = 0; pageIndex < pages && cursor; pageIndex++) {
    const page = await source.fetchPage(cursor);
    for (const raw of page.items || []) {
      const offer = source.normalizeOffer(raw as never);
      if (offer?.id && !offers.has(offer.id)) offers.set(offer.id, offer);
    }
    cursor = page.finished ? null : (page.nextCursor || null);
  }
  return [...offers.values()];
}

export type GeorgiaRecoverySource = "all" | "myauto" | "autopapa";

function boundedInteger(value: unknown, fallback: number, maximum: number) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) ? Math.max(1, Math.min(maximum, parsed)) : fallback;
}

export async function collectGeorgiaYandexRecoverySnapshot(
  pagesPerSource = 2,
  startPage = 1,
  source: GeorgiaRecoverySource = "all",
): Promise<RecoverySnapshot> {
  const pages = boundedInteger(pagesPerSource, 2, 20);
  const firstPage = boundedInteger(startPage, 1, 10_000);
  const selectedSource: GeorgiaRecoverySource = ["myauto", "autopapa"].includes(source) ? source : "all";
  const rejected: Record<string, number> = {};
  const reject = (reason: string) => { rejected[reason] = Number(rejected[reason] || 0) + 1; };

  const [myAutoRows, autoPapaRows] = await Promise.all([
    selectedSource === "autopapa" ? Promise.resolve([]) : collectPages(myAutoListSource, pages, firstPage),
    selectedSource === "myauto" ? Promise.resolve([]) : collectPages(autoPapaGeorgiaSource, pages, firstPage),
  ]);
  const rawSourceCounts = {
    myauto_georgia_list: myAutoRows.length,
    autopapa_georgia_open: autoPapaRows.length,
  };
  const incoming = [...myAutoRows, ...autoPapaRows]
    .filter((offer) => isCatalogMarketSourceAllowed(offer) && isCatalogYearAllowed(offer.year, "georgia"));

  const prepared = await pool(incoming, 4, async (raw): Promise<VehicleOffer | null> => {
    try {
      let offer: VehicleOffer = raw.sourceId === "myauto_georgia_list"
        ? await prepareMyAuto(raw)
        : await prepareAutoPapa(raw);
      if (!offer.images.length || !(Number(offer.sourcePrice || 0) > 0) || !String(offer.sourceCurrency || "")) {
        reject("visible_core");
        return null;
      }
      offer = await enrichExactVariant(offer);
      if (["electric", "series_hybrid", "other_hybrid"].includes(String(offer.powertrainKind || ""))) {
        offer = normalizeVehicleOfferSpecs(await enrichOfferWithCertifiedPower(offer));
      }
      offer = normalizeVehicleOfferSpecs(await calculateOfferWithPreliminaryPowerPricing(offer));
      if (!exactCalculation(offer) && !isPreliminaryPowerPendingCalculation(offer)) {
        reject("calculation");
        return null;
      }
      offer.status = "active";
      offer.operational = {
        ...offer.operational,
        raw: {
          ...rawRecord(offer),
          recoveryExactSourceUrl: true,
          recoveryExactPhotoIdentity: true,
          recoveryCalculatedRub: true,
          recoveryPreliminaryPowerPending: isPreliminaryPowerPendingCalculation(offer),
          recoveryBodySourceOnly: true,
        },
      };
      return offer;
    } catch (error) {
      const message = String((error as Error)?.message || error).replace(/[^a-z0-9_:-]+/gi, "_").slice(0, 120) || "prepare";
      reject(message);
      return null;
    }
  });

  const offers = prepared.filter((offer): offer is VehicleOffer => Boolean(offer));
  const sourceCounts = Object.fromEntries(["myauto_georgia_list", "autopapa_georgia_open"]
    .map((sourceId) => [sourceId, offers.filter((offer) => offer.sourceId === sourceId).length]));
  const imageCounts = offers.map((offer) => offer.images.length);
  return {
    market: "georgia",
    count: offers.length,
    partial: true,
    report: {
      mode: "yandex_read_only_canonical_recovery_snapshot",
      pagesPerSource: pages,
      startPage: firstPage,
      source: selectedSource,
      rawSourceCounts,
      sourceCounts,
      rejected,
      imageStats: imageCounts.length ? {
        min: Math.min(...imageCounts),
        max: Math.max(...imageCounts),
        average: Number((imageCounts.reduce((sum, value) => sum + value, 0) / imageCounts.length).toFixed(2)),
      } : { min: 0, max: 0, average: 0 },
      calculatedCount: offers.filter(exactCalculation).length,
      preliminaryCount: offers.filter(isPreliminaryPowerPendingCalculation).length,
    },
    offers,
  };
}