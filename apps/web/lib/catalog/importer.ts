import crypto from "node:crypto";
import { mutateDataJson, readDataJson, writeDataJson } from "../data";
import { calculateOffer, catalogSources } from "./adapters";
import { publicMarketSources } from "./public-market-sources";
import { persistCatalogOffers, readAllOffersForMaintenance } from "./storage";
import { getSourcePolicy, policyAllowsRun, updatePolicyAfterRun } from "./policy";
import type { CatalogImage, CatalogMarket, VehicleOffer } from "./types";

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

const PUBLIC_MARKETS: CatalogMarket[] = ["korea", "china", "japan", "uae", "europe"];

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

function isFixedPublicMarket(value: string): value is CatalogMarket {
  return PUBLIC_MARKETS.includes(value as CatalogMarket);
}

export async function importCatalog(sourceIdsOrOptions?: string[] | CatalogImportOptions) {
  const options: CatalogImportOptions = Array.isArray(sourceIdsOrOptions) ? { sourceIds: sourceIdsOrOptions } : (sourceIdsOrOptions || {});
  if (options.requireObjectStorage) assertProductionStorage();
  const sourceIds = options.sourceIds;
  const maxImagesPerOffer = Math.max(1, Number(options.maxImagesPerOffer || process.env.CATALOG_MAX_IMAGES_PER_OFFER || 10));
  const targetPerMarket = Math.max(1, Number(process.env.CATALOG_TARGET_PER_MARKET || 250));
  const importBudgetMs = Math.max(60_000, Number(process.env.CATALOG_IMPORT_BUDGET_MS || 42 * 60 * 1000));
  const sourceBudgetMs = Math.max(30_000, Number(process.env.CATALOG_SOURCE_BUDGET_MS || 8 * 60 * 1000));
  const operationId = `catalog_import_${crypto.randomUUID()}`;
  const startedAt = new Date().toISOString();
  const importDeadlineAt = Date.now() + importBudgetMs;

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

  const refreshedByMarket = Object.fromEntries(PUBLIC_MARKETS.map((market) => [market, 0])) as Record<CatalogMarket, number>;
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
    targetPublicOffers: Number(process.env.CATALOG_TARGET_PUBLIC_OFFERS || 1250),
    targetPerMarket,
    refreshedByMarket,
    deadlineReached: false,
    sources: [],
  };

  try {
    const selectedSources = catalogImportSources.filter((item) => !sourceIds?.length || sourceIds.includes(item.sourceId));
    for (const source of selectedSources) {
      if (Date.now() >= importDeadlineAt) {
        report.deadlineReached = true;
        report.sources.push({ sourceId: source.sourceId, market: source.market, ok: false, skipped: true, error: "global_import_budget_reached" });
        break;
      }

      const fixedMarket = isFixedPublicMarket(String(source.market)) ? source.market as CatalogMarket : null;
      if (fixedMarket && refreshedByMarket[fixedMarket] >= targetPerMarket) {
        report.sources.push({ sourceId: source.sourceId, market: source.market, ok: true, skipped: true, seen: 0, saved: 0, reason: "daily_market_target_already_reached" });
        console.log(`[catalog] skip ${source.sourceId}: ${fixedMarket} daily target already reached`);
        continue;
      }

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
      let savedThisSource = 0;
      const seen = new Set<string>();
      let sourceOk = false;
      let sourceExhausted = false;
      let stoppedByLimit = false;
      let stoppedByBudget = false;
      let lastHealth: any = { ok: true, message: "ok", checkedAt: new Date().toISOString() };
      const sourceDeadlineAt = Math.min(importDeadlineAt, Date.now() + sourceBudgetMs);
      const configuredMaxPages = Math.min(policy.maxPagesPerRun, options.maxPages ?? policy.maxPagesPerRun);
      const configuredMaxOffers = Math.min(policy.maxOffersPerRun, options.maxOffers ?? policy.maxOffersPerRun);
      const configuredMaxDetails = Math.min(policy.maxDetailsPerRun, options.maxDetails ?? policy.maxDetailsPerRun);
      const marketRemaining = fixedMarket ? Math.max(0, targetPerMarket - refreshedByMarket[fixedMarket]) : configuredMaxOffers;
      const sourceMaxOffers = Math.min(configuredMaxOffers, marketRemaining || configuredMaxOffers);

      console.log(`[catalog] source ${source.sourceId} (${source.market}) start; limit=${sourceMaxOffers}, photos=${maxImagesPerOffer}`);

      try {
        do {
          if (Date.now() >= sourceDeadlineAt) {
            stoppedByBudget = true;
            stoppedByLimit = true;
            break;
          }

          page++;
          if (page > configuredMaxPages || seen.size >= sourceMaxOffers || sourceDetails >= configuredMaxDetails) {
            stoppedByLimit = true;
            break;
          }

          console.log(`[catalog] ${source.sourceId}: page ${page}, seen ${seen.size}, saved ${savedThisSource}`);
          const fetched: any = await source.fetchPage(cursor);
          lastHealth = fetched.health || lastHealth;
          await refreshLock();

          for (const raw of fetched.items.slice(0, sourceMaxOffers - seen.size)) {
            if (Date.now() >= sourceDeadlineAt) {
              stoppedByBudget = true;
              stoppedByLimit = true;
              break;
            }

            const normalized = source.normalizeOffer(raw);
            if (!normalized) {
              report.skipped++;
              continue;
            }

            const normalizedMarket = isFixedPublicMarket(String(normalized.market)) ? normalized.market as CatalogMarket : fixedMarket;
            if (normalizedMarket && refreshedByMarket[normalizedMarket] >= targetPerMarket) {
              stoppedByLimit = true;
              break;
            }

            const previous = existing.get(normalized.id);
            const base = mergeOfferBase(previous, normalized, startedAt, scan.scanCycleId);
            seen.add(base.id);
            let images: any[] = []; await refreshLock();

            const previousImages = (previous?.images || []).slice(0, maxImagesPerOffer);
            images = previousImages;
            let attemptedImages = false;

            if (policy.imagesEnabled && sourceDetails < configuredMaxDetails && images.length < maxImagesPerOffer) {
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
            savedThisSource++;
            if (normalizedMarket) refreshedByMarket[normalizedMarket]++;

            if (savedThisSource % 10 === 0) {
              console.log(`[catalog] ${source.sourceId}: saved ${savedThisSource}, market total today ${normalizedMarket ? refreshedByMarket[normalizedMarket] : "n/a"}`);
            }
          }

          cursor = fetched.nextCursor;
          if (fetched.finished && !cursor) {
            sourceExhausted = true;
            break;
          }
          if (stoppedByBudget || (fixedMarket && refreshedByMarket[fixedMarket] >= targetPerMarket)) {
            stoppedByLimit = true;
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
        report.sources.push({
          sourceId: source.sourceId,
          market: source.market,
          scanCycleId: scan.scanCycleId,
          ok: true,
          seen: seen.size,
          saved: savedThisSource,
          cursor,
          sourceExhausted,
          stoppedByLimit,
          stoppedByBudget,
          partialScan,
          staleEligible,
        });
        await updatePolicyAfterRun(source, { ...lastHealth, ok: true }, staleEligible ? null : cursor);
      } catch (error: any) {
        lastHealth = { ok: false, message: error?.message || "import_failed", checkedAt: new Date().toISOString(), blocked: Boolean(error?.blocked), httpStatus: error?.status };
        report.sources.push({ sourceId: source.sourceId, market: source.market, ok: false, seen: seen.size, saved: savedThisSource, error: lastHealth.message });
        await writeDataJson(`catalog/scans/${source.sourceId}.json`, { ...(scan || {}), status: "running", cursor, lastError: lastHealth.message, retryAt: new Date(Date.now() + Number(process.env.CATALOG_SOURCE_RETRY_MS || 300000)).toISOString() });
        await updatePolicyAfterRun(source, lastHealth, cursor || null);
      }

      console.log(`[catalog] source ${source.sourceId} done; seen=${seen.size}, saved=${savedThisSource}, error=${lastHealth.ok ? "none" : lastHealth.message}`);
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
    report.targetReached = PUBLIC_MARKETS.every((market) => Number(report.publicByMarket[market] || 0) >= targetPerMarket);
    report.finishedAt = new Date().toISOString();
    report.durationMs = Date.parse(report.finishedAt) - Date.parse(startedAt);

    const manifest = await readDataJson<any>("catalog/manifest.json", {});
    report.generationId = manifest.generationId;
    const reportPath = options.reportPath || `catalog/imports/${startedAt.replace(/[:.]/g, "-")}.json`;
    await writeDataJson(reportPath, report);
    if (options.failOnZeroSaved && report.imported + report.updated <= 0 && report.publicOffers <= 0) throw new Error("catalog_import_saved_zero_offers");
    return report;
  } finally {
    await mutateDataJson<any>("catalog/import-lock.json", { lockedUntil: "" }, (lock) => lock.operationId === operationId
      ? { operationId, lockedUntil: "", finishedAt: new Date().toISOString() }
      : lock);
  }
}
