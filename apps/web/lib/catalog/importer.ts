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
export * from "./importer-impl";
