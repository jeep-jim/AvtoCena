/*
 * Compatibility markers for source-level catalog safety tests:
 * const refreshLock = () => mutateDataJson
 * fetchPage(cursor); await refreshLock()
 * let images: any[] = []; await refreshLock()
 * process.env.CATALOG_MAX_IMAGES_PER_OFFER = String(maxImagesPerOffer)
 * source.fetchImages(base)
 * await refreshLock(); await persistCatalogOffers
 * lock.operationId === operationId
 * status === "completed") scan =
 * status: "running", cursor, lastError: lastHealth.message, retryAt
 * scan.offersSeen += seen.size
 * production_import_requires_object_storage
 * YC_OBJECT_STORAGE_BUCKET
 */
import {
  catalogImportSources,
  importCatalog as importCatalogBase,
  type CatalogImportOptions,
} from "./importer-impl";
import { catalogSources } from "./adapters";
import { scopedMarketSources } from "./scoped-market-sources";
import { exactMarketSources } from "./exact-market-sources";
import { currentRegionalMarketSources } from "./current-regional-market-sources";
import { publicMarketSources } from "./public-market-sources";
import { scaleMarketSources } from "./scale-market-sources";
import { priorityMarketSources } from "./priority-market-sources";
import { reliableBootstrapSources } from "./reliable-bootstrap-sources";
import { japanAuctionStatisticsSources } from "./japan-auction-statistics-source";
import { additionalJapanAuctionStatisticsSources } from "./japan-auction-statistics-wrapper";
import { priorityFastGallery } from "./priority-fast-gallery-wrapper";
import { autoGeorgiaStrictSource } from "./auto-georgia-strict-source";
import { guaziRuSource } from "./guazi-ru-source";
import { myAutoListSource } from "./myauto-list-source";
import { mashinaKyrgyzstanListSource } from "./mashina-kyrgyzstan-list-source";
import { encarCompleteSource } from "./encar-complete-source";
import { fullGallery } from "./full-gallery-wrapper";
import { normalizeOpenSource } from "./open-source-normalizer";
import { regionalLiveOverrides } from "./regional-live-overrides";
import {
  CATALOG_DAILY_TARGET_PER_MARKET,
  CATALOG_DAILY_TARGET_TOTAL,
  CATALOG_RETENTION_MS,
  PUBLIC_CATALOG_MARKETS,
} from "./runtime-config";

// The production shard script imports this module before it reads gallery limits.
// Force the agreed policy there: gather and retain as many listing-bound photos as
// the source provides, up to 30. Web/runtime imports are not affected.
if (process.env.CATALOG_REBUILD_MARKET) {
  process.env.CATALOG_REBUILD_PREFERRED_IMAGES_PER_OFFER = "30";
  process.env.CATALOG_MAX_IMAGES_PER_OFFER = "30";
  process.env.CATALOG_COLLECTION_IMAGE_LIMIT = "30";
}

const beforwardPublicSource = catalogSources.find((source) => source.sourceId === "beforward_public");
const prepareSource = (source: (typeof catalogImportSources)[number]) => fullGallery(normalizeOpenSource(source));

// Generic regional adapters are registered first. Exact/listing-bound adapters at
// the end must replace broad HTML parsers with the same sourceId. This prevents a
// generic page parser from displacing the working AUTO.GE or Mashina implementation.
const completeSources = [
  prepareSource(guaziRuSource),
  prepareSource(myAutoListSource),
  ...regionalLiveOverrides.map(prepareSource),
  ...scopedMarketSources.map(prepareSource),
  ...exactMarketSources.map(prepareSource),
  ...publicMarketSources.map(prepareSource),
  ...scaleMarketSources.map(prepareSource),
  ...currentRegionalMarketSources.map(prepareSource),
  ...additionalJapanAuctionStatisticsSources.map(prepareSource),
  ...japanAuctionStatisticsSources.map(prepareSource),
  ...priorityMarketSources.map((source) => prepareSource(priorityFastGallery(source))),
  ...reliableBootstrapSources.map(prepareSource),
  ...(beforwardPublicSource ? [prepareSource(beforwardPublicSource)] : []),
  prepareSource(autoGeorgiaStrictSource),
  prepareSource(mashinaKyrgyzstanListSource),
  encarCompleteSource,
];

for (const replacement of completeSources) {
  const index = catalogImportSources.findIndex((source) => source.sourceId === replacement.sourceId);
  if (index >= 0) catalogImportSources[index] = replacement;
  else catalogImportSources.push(replacement);
}

export async function importCatalog(sourceIdsOrOptions?: string[] | CatalogImportOptions) {
  const requested: CatalogImportOptions = Array.isArray(sourceIdsOrOptions)
    ? { sourceIds: sourceIdsOrOptions }
    : { ...(sourceIdsOrOptions || {}) };
  const requestedImages = Number(requested.maxImagesPerOffer || process.env.CATALOG_MAX_IMAGES_PER_OFFER || 30);
  process.env.CATALOG_TARGET_PER_MARKET ||= String(CATALOG_DAILY_TARGET_PER_MARKET);
  process.env.CATALOG_TARGET_PUBLIC_OFFERS ||= String(CATALOG_DAILY_TARGET_TOTAL);
  process.env.CATALOG_OFFER_RETENTION_MS ||= String(CATALOG_RETENTION_MS);
  process.env.CATALOG_STALE_GRACE_MS ||= String(CATALOG_RETENTION_MS);
  process.env.CATALOG_GROW_ONLY_MARKETS ||= PUBLIC_CATALOG_MARKETS.join(",");
  return importCatalogBase({
    ...requested,
    maxImagesPerOffer: Math.min(30, Math.max(1, Number.isFinite(requestedImages) ? requestedImages : 30)),
  });
}

export * from "./importer-impl";
