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
import { publicMarketSources } from "./public-market-sources";
import { encarCompleteSource } from "./encar-complete-source";
import { fullGallery } from "./full-gallery-wrapper";

const beforwardPublicSource = catalogSources.find((source) => source.sourceId === "beforward_public");
const completeSources = [
  ...scopedMarketSources.map((source) => fullGallery(source)),
  ...exactMarketSources.map((source) => fullGallery(source)),
  ...publicMarketSources.map((source) => fullGallery(source)),
  ...(beforwardPublicSource ? [fullGallery(beforwardPublicSource)] : []),
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
  const requestedImages = Number(requested.maxImagesPerOffer || process.env.CATALOG_MAX_IMAGES_PER_OFFER || 1000);
  return importCatalogBase({
    ...requested,
    maxImagesPerOffer: Math.min(1000, Math.max(1, Number.isFinite(requestedImages) ? requestedImages : 1000)),
  });
}

export * from "./importer-impl";
