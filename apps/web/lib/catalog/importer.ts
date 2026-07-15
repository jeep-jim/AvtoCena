import crypto from "node:crypto";
import { mutateDataJson, readDataJson, writeDataJson } from "../data";
import { calculateOffer, catalogSources } from "./adapters";
import { publicMarketSources } from "./public-market-sources";
import { persistCatalogOffers, readAllOffersForMaintenance } from "./storage";
import { getSourcePolicy, policyAllowsRun, updatePolicyAfterRun } from "./policy";
import type { CatalogImage, VehicleOffer } from "./types";

export type CatalogImportOptions = {
  sourceIds?: string[];
  maxOffers?: number;
  maxDetails?: number;
  maxImagesPerOffer?: number;
  maxPages?: number;
  requireObjectStorage?: boolean;
  failOnZeroSaved?: boolean;
  reportPath?: string;
};

export const catalogImportSources = [
  ...catalogSources.filter((source) => source.sourceId !== "beforward_public"),
  ...publicMarketSources,
];

function assertProductionStorage() {
  if (process.env.JSON_STORAGE_DRIVER !== "object") throw new Error("production_import_requires_object_storage");
  for (const name of ["YC_OBJECT_STORAGE_BUCKET", "YC_OBJECT_STORAGE_ACCESS_KEY_ID", "YC_OBJECT_STORAGE_SECRET_ACCESS_KEY"]) {
    if (!process.env[name]) throw new Error(`production_import_missing_${name}`);
  }
}

function imageIdentity(image: CatalogImage | undefined) {
  if (!image) return "";
  return String(image.id || image.checksum || image.objectKey || image.url || "");
}

function mergeImages(previous: CatalogImage[], fresh: CatalogImage[], limit: number) {
  const result: CatalogImage[] = [];
  const seen = new Set<string>();
  for (const image of [...previous, ...fresh]) {
    const key = imageIdentity(image);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(image);
    if (result.length >= limit) break;
  }
  return result;
}

function mergeOfferBase(previous: VehicleOffer | undefined, base: VehicleOffer, seenAt: string, scanCycleId: string) {
  if (!previous) {
    return {
      ...base,
      operational: {
        ...base.operational,
        lastSeenScanCycleId: scanCycleId,
        lastSeenAt: seenAt,
      },
    } as VehicleOffer;
  }

  return {
    ...previous,
    ...base,
    firstSeenAt: previous.firstSeenAt || base.firstSeenAt,
    images: previous.images || [],
    operational: {
      ...previous.operational,
      ...base.operational,
      lastSeenScanCycleId: scanCycleId,
      lastSeenAt: seenAt,
    },
  } as VehicleOffer;
}

export function applyPriceTrend(next: VehicleOffer, previous: VehicleOffer | undefined, changedAt: string): VehicleOffer {
  if (!previous) return next;

  const currentTotal = Number(next.totalRub || 0);
  const previousTotal = Number(previous.totalRub || 0);
  if (!currentTotal || !previousTotal) return next;

  const delta = currentTotal - previousTotal;
  if (Math.abs(delta) >= 1_000) {
    return {
      ...next,
      previousTotalRub: previousTotal,
      priceDeltaRub: delta,
      priceChangedAt: changedAt,
    };
  }

  return {
    ...next,
    previousTotalRub: previous.previousTotalRub,
    priceDeltaRub: previous.priceDeltaRub,
    priceChangedAt: previous.priceChangedAt,
  };
}

export async function importCatalog(sourceIdsOrOptions?: string[] | CatalogImportOptions) {
  const options: CatalogImportOptions = Array.isArray(sourceIdsOrOptions) ? { sourceIds: sourceIdsOrOptions } : (sourceIdsOrOptions || {});
  if (options.requireObjectStorage) assertProductionStorage();
  const sourceIds = options.sourceIds;
  const maxImagesPerOffer = Math.max(1, Number(options.maxImagesPerOffer || process.env.CATALOG_MAX_IMAGES_PER_OFFER || 6));
  const operationId = `catalog_import_${crypto.randomUUID()}`;
  const startedAt = new Date().toISOString();

  await mutateDataJson<any>("catalog/import-lock.json", { lockedUntil: "" }, (current) => {
    if (current.lockedUntil && Date.parse(current.lockedUntil) > Date.now()) throw new Error("catalog_import_locked");
    return { operationId, lockedUntil: new Date(Date.now() + 15 * 60 * 1000).toISOString(), startedAt };
  });

  const refreshLock = () => mutateDataJson<any>("catalog/import-lock.json", { lockedUntil: "" }, (lock) => lock.operationId === operationId
    ? { ...lock, lockedUntil: new Date(Date.now() + 15 * 60 * 1000).toISOString(), heartbeatAt: new Date().toISOString() }
    : lock);

  const storedOffers = await readAllOffersForMaintenance();
  const existing = new Map(storedOffers.map((offer) => {
    const operational = offer.operational as any;
    if (!operational?.lastSeenAt) {
      offer.operational = { ...offer.operational, lastSeenAt: startedAt } as any;
    }
    return [offer.id, offer] as const;
  }));

  const report: any = {
    operationId,
    startedAt,
    imported: 0,
    updated: 0,
    expired: 0,
    skipped: 0,
    imageFailures: 0,
    underfilledImages: 0,
    reusedImageSets: 0,
    details: 0,
    targetPublicOffers: Number(process.env.CATALOG_TARGET_PUBLIC_OFFERS || 224),
    sources: [],
  };

  try {
    for (const source of catalogImportSources.filter((item) => !sourceIds?.length || sourceIds.includes(item.sourceId))) {
      const policy = await getSourcePolicy(source);
      if (!policyAllowsRun(policy)) {
        report.sources.push({ sourceId: source.sourceId, market: source.market, ok: false, skipped: true, error: "source_disabled_or_blocked" });
        continue;
      }

      let scan = await readDataJson<any>(`catalog/scans/${source.sourceId}.json`, null);
      if (!scan || scan.status === "completed") scan = {
        scanCycleId: `scan_${crypto.randomUUID()}`,
        startedAt: new Date().toISOString(),
        cursor: policy.lastSuccessfulCursor || null,
        status: "running",
        pagesProcessed: 0,
        offersSeen: 0,
        lastCompletedAt: scan?.lastCompletedAt,
      };

      let cursor: string | null | undefined = scan.cursor || null;
      let page = 0;
      let sourceDetails = 0;
      const seen = new Set<string>();
      let sourceOk = false;
      let sourceExhausted = false;
      let stoppedByLimit = false;
      let lastHealth: any = { ok: true, message: "ok", checkedAt: new Date().toISOString() };

      try {
        do {
          page++;
          const maxPages = Math.min(policy.maxPagesPerRun, options.maxPages ?? policy.maxPagesPerRun);
          const maxOffers = Math.min(policy.maxOffersPerRun, options.maxOffers ?? policy.maxOffersPerRun);
          const maxDetails = Math.min(policy.maxDetailsPerRun, options.maxDetails ?? policy.maxDetailsPerRun);
          if (page > maxPages || seen.size >= maxOffers || sourceDetails >= maxDetails) {
            stoppedByLimit = true;
            break;
          }

          const fetched: any = await source.fetchPage(cursor);
          lastHealth = fetched.health || lastHealth;
          await refreshLock();

          for (const raw of fetched.items.slice(0, maxOffers - seen.size)) {
            const normalized = source.normalizeOffer(raw);
            if (!normalized) {
              report.skipped++;
              continue;
            }

            const previous = existing.get(normalized.id);
            const base = mergeOfferBase(previous, normalized, startedAt, scan.scanCycleId);
            seen.add(base.id);
            let images: any[] = []; await refreshLock();

            const previousImages = (previous?.images || []).slice(0, maxImagesPerOffer);
            images = previousImages;
            let attemptedImages = false;

            if (policy.imagesEnabled && sourceDetails < maxDetails && images.length < maxImagesPerOffer) {
              attemptedImages = true;
              const previousImageLimit = process.env.CATALOG_MAX_IMAGES_PER_OFFER;
              process.env.CATALOG_MAX_IMAGES_PER_OFFER = String(maxImagesPerOffer);
              try {
                const freshImages = await source.fetchImages(base);
                images = mergeImages(previousImages, freshImages, maxImagesPerOffer);
              } finally {
                if (previousImageLimit === undefined) delete process.env.CATALOG_MAX_IMAGES_PER_OFFER;
                else process.env.CATALOG_MAX_IMAGES_PER_OFFER = previousImageLimit;
              }
              await refreshLock();
              sourceDetails++;
              report.details++;
            } else if (images.length >= maxImagesPerOffer) {
              report.reusedImageSets++;
            }

            if (attemptedImages && images.length === previousImages.length && images.length < maxImagesPerOffer) {
              report.imageFailures++;
            }

            if (!images.length) {
              report.skipped++;
              if (previous) {
                existing.set(base.id, {
                  ...previous,
                  operational: {
                    ...previous.operational,
                    lastSeenScanCycleId: scan.scanCycleId,
                    lastSeenAt: startedAt,
                  },
                } as VehicleOffer);
              }
              continue;
            }

            if (images.length < maxImagesPerOffer) report.underfilledImages++;

            const calculated = await calculateOffer({
              ...base,
              images,
              firstSeenAt: previous?.firstSeenAt || base.firstSeenAt,
            });
            const offer = applyPriceTrend(calculated, previous, startedAt);
            previous ? report.updated++ : report.imported++;
            existing.set(offer.id, offer);
          }

          cursor = fetched.nextCursor;
          if (fetched.finished && !cursor) {
            sourceExhausted = true;
            break;
          }
        } while (cursor);

        scan.pagesProcessed += page;
        scan.offersSeen += seen.size;
        const previousSourceCount = [...existing.values()].filter((offer) => offer.sourceId === source.sourceId).length;
        const sane = scan.offersSeen > 0 && !(previousSourceCount >= 10000 && scan.offersSeen <= 100);
        sourceOk = true;
        const partialScan = Boolean(cursor) || stoppedByLimit;
        const staleEligible = sourceExhausted && !stoppedByLimit && sane;
        scan.cursor = staleEligible ? null : cursor;
        scan.status = staleEligible ? "completed" : "running";
        if (staleEligible) scan.lastCompletedAt = new Date().toISOString();
        await writeDataJson(`catalog/scans/${source.sourceId}.json`, scan);
        report.sources.push({ sourceId: source.sourceId, market: source.market, scanCycleId: scan.scanCycleId, ok: true, seen: seen.size, cursor, sourceExhausted, stoppedByLimit, partialScan, staleEligible });
        await updatePolicyAfterRun(source, { ...lastHealth, ok: true }, staleEligible ? null : cursor);
      } catch (error: any) {
        lastHealth = { ok: false, message: error?.message || "import_failed", checkedAt: new Date().toISOString(), blocked: Boolean(error?.blocked), httpStatus: error?.status };
        report.sources.push({ sourceId: source.sourceId, market: source.market, ok: false, error: lastHealth.message });
        await writeDataJson(`catalog/scans/${source.sourceId}.json`, { ...(scan || {}), status: "running", cursor, lastError: lastHealth.message, retryAt: new Date(Date.now() + Number(process.env.CATALOG_SOURCE_RETRY_MS || 300000)).toISOString() });
        await updatePolicyAfterRun(source, lastHealth, cursor || null);
      }

      await writeDataJson(`catalog/health/${source.sourceId}.json`, lastHealth);
      if (sourceOk && sourceExhausted && !stoppedByLimit && scan.offersSeen > 0) {
        const previousSourceCount = [...existing.values()].filter((offer) => offer.sourceId === source.sourceId).length;
        if (!(previousSourceCount >= 10000 && scan.offersSeen <= 100)) {
          const graceMs = Number(process.env.CATALOG_STALE_GRACE_MS || 172_800_000);
          const now = Date.now();
          for (const offer of existing.values()) {
            if (offer.sourceId === source.sourceId && (offer.operational as any)?.lastSeenScanCycleId !== scan.scanCycleId && now - Date.parse(offer.updatedAt) > graceMs) {
              offer.status = "stale";
              report.expired++;
            }
          }
        }
      }
    }

    const retentionMs = Number(process.env.CATALOG_OFFER_RETENTION_MS || 172_800_000);
    const now = Date.now();
    for (const offer of existing.values()) {
      if (offer.status !== "active") continue;
      const lastSeenAt = Date.parse(String((offer.operational as any)?.lastSeenAt || ""));
      if (Number.isFinite(lastSeenAt) && now - lastSeenAt > retentionMs) {
        offer.status = "stale";
        report.expired++;
      }
    }

    await refreshLock(); await persistCatalogOffers([...existing.values()] as VehicleOffer[]);

    const publicOffers = [...existing.values()].filter((offer: any) => offer.status === "active" && Array.isArray(offer.images) && offer.images.length > 0);
    report.publicOffers = publicOffers.length;
    report.publicByMarket = publicOffers.reduce((totals: Record<string, number>, offer: any) => {
      totals[offer.market] = (totals[offer.market] || 0) + 1;
      return totals;
    }, {});
    report.targetReached = report.publicOffers >= report.targetPublicOffers;

    const manifest = await readDataJson<any>("catalog/manifest.json", {});
    report.generationId = manifest.generationId;
    const reportPath = options.reportPath || `catalog/imports/${startedAt.replace(/[:.]/g, "-")}.json`;
    await writeDataJson(reportPath, report);
    if (options.failOnZeroSaved && report.imported + report.updated <= 0) throw new Error("catalog_import_saved_zero_offers");
    return report;
  } finally {
    await mutateDataJson<any>("catalog/import-lock.json", { lockedUntil: "" }, (lock) => lock.operationId === operationId
      ? { operationId, lockedUntil: "", finishedAt: new Date().toISOString() }
      : lock);
  }
}
