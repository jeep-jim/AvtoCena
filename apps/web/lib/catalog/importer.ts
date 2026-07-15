import crypto from "node:crypto";
import { mutateDataJson, readDataJson, writeDataJson } from "../data";
import { calculateOffer, catalogSources } from "./adapters";
import { publicMarketSources } from "./public-market-sources";
import { persistCatalogOffers, readAllOffersForMaintenance } from "./storage";
import { getSourcePolicy, policyAllowsRun, updatePolicyAfterRun } from "./policy";
import type { VehicleOffer } from "./types";

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
  const maxImagesPerOffer = options.maxImagesPerOffer;
  const operationId = `catalog_import_${crypto.randomUUID()}`;
  const startedAt = new Date().toISOString();

  await mutateDataJson<any>("catalog/import-lock.json", { lockedUntil: "" }, (current) => {
    if (current.lockedUntil && Date.parse(current.lockedUntil) > Date.now()) throw new Error("catalog_import_locked");
    return { operationId, lockedUntil: new Date(Date.now() + 15 * 60 * 1000).toISOString(), startedAt };
  });

  const refreshLock = () => mutateDataJson<any>("catalog/import-lock.json", { lockedUntil: "" }, (lock) => lock.operationId === operationId
    ? { ...lock, lockedUntil: new Date(Date.now() + 15 * 60 * 1000).toISOString(), heartbeatAt: new Date().toISOString() }
    : lock);
  const existing = new Map((await readAllOffersForMaintenance()).map((offer) => [offer.id, offer]));
  const report: any = { operationId, startedAt, imported: 0, updated: 0, expired: 0, skipped: 0, imageFailures: 0, details: 0, sources: [] };

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
            const base = source.normalizeOffer(raw);
            if (!base) {
              report.skipped++;
              continue;
            }

            const previous = existing.get(base.id);
            let images: any[] = []; await refreshLock();
            seen.add(base.id);
            base.operational = { ...base.operational, lastSeenScanCycleId: scan.scanCycleId } as any;

            if (policy.imagesEnabled && sourceDetails < maxDetails) {
              const previousImageLimit = process.env.CATALOG_MAX_IMAGES_PER_OFFER;
              if (maxImagesPerOffer) process.env.CATALOG_MAX_IMAGES_PER_OFFER = String(maxImagesPerOffer);
              try {
                images = await source.fetchImages(base);
              } finally {
                if (previousImageLimit === undefined) delete process.env.CATALOG_MAX_IMAGES_PER_OFFER;
                else process.env.CATALOG_MAX_IMAGES_PER_OFFER = previousImageLimit;
              }
              await refreshLock();
              if (maxImagesPerOffer) images = images.slice(0, maxImagesPerOffer);
              sourceDetails++;
              report.details++;
            }

            if (!images.length) {
              report.imageFailures++;
              report.skipped++;
              if (previous) existing.set(base.id, { ...previous, updatedAt: base.updatedAt, operational: { ...previous.operational, lastSeenScanCycleId: scan.scanCycleId } });
              continue;
            }

            const calculated = await calculateOffer({ ...base, images, firstSeenAt: previous?.firstSeenAt || base.firstSeenAt });
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
          const graceMs = Number(process.env.CATALOG_STALE_GRACE_MS || 86_400_000);
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

    await refreshLock(); await persistCatalogOffers([...existing.values()] as VehicleOffer[]);
    report.publicOffers = [...existing.values()].filter((offer: any) => offer.status === "active" && Array.isArray(offer.images) && offer.images.length > 0).length;
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
