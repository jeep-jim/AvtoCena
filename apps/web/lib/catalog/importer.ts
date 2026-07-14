import crypto from "node:crypto";
import { mutateDataJson, readDataJson, writeDataJson } from "../data";
import { calculateOffer, catalogSources } from "./adapters";
import { persistCatalogOffers, readAllOffersForMaintenance } from "./storage";
import { getSourcePolicy, policyAllowsRun, updatePolicyAfterRun } from "./policy";
import type { VehicleOffer } from "./types";

export async function importCatalog(sourceIds?: string[]) {
  const operationId = `catalog_import_${crypto.randomUUID()}`; const startedAt = new Date().toISOString();
  const lock = await mutateDataJson<any>("catalog/import-lock.json", { lockedUntil: "" }, (current) => { if (current.lockedUntil && Date.parse(current.lockedUntil) > Date.now()) throw new Error("catalog_import_locked"); return { operationId, lockedUntil: new Date(Date.now() + 15 * 60 * 1000).toISOString(), startedAt }; });
  const existing = new Map((await readAllOffersForMaintenance()).map((o) => [o.id, o]));
  const report: any = { operationId, startedAt, imported: 0, updated: 0, expired: 0, skipped: 0, imageFailures: 0, details: 0, sources: [] };
  try {
    for (const source of catalogSources.filter(s => !sourceIds?.length || sourceIds.includes(s.sourceId))) {
      const policy = await getSourcePolicy(source); if (!policyAllowsRun(policy)) { report.sources.push({ sourceId: source.sourceId, ok: false, skipped: true, error: "source_disabled_or_blocked" }); continue; }
      let scan = await readDataJson<any>(`catalog/scans/${source.sourceId}.json`, null); if (!scan || scan.status === "completed" || scan.status === "failed") scan = { scanCycleId: `scan_${crypto.randomUUID()}`, startedAt: new Date().toISOString(), cursor: policy.lastSuccessfulCursor || null, status: "running", pagesProcessed: 0, offersSeen: 0, lastCompletedAt: scan?.lastCompletedAt }; let cursor: string | null | undefined = scan.cursor || null; let page = 0; let sourceDetails = 0; const seen = new Set<string>(); let sourceOk = false; let sourceExhausted = false; let stoppedByLimit = false; let lastHealth: any = { ok: true, message: "ok", checkedAt: new Date().toISOString() };
      try {
        do { page++; if (page > policy.maxPagesPerRun || seen.size >= policy.maxOffersPerRun || sourceDetails >= policy.maxDetailsPerRun) { stoppedByLimit = true; break; } const fetched: any = await source.fetchPage(cursor); lastHealth = fetched.health || lastHealth;
          for (const raw of fetched.items.slice(0, policy.maxOffersPerRun - seen.size)) { const base = source.normalizeOffer(raw); if (!base) { report.skipped++; continue; } let images: any[] = []; seen.add(base.id); base.operational = { ...base.operational, lastSeenScanCycleId: scan.scanCycleId } as any; if (policy.imagesEnabled && sourceDetails < policy.maxDetailsPerRun) { images = await source.fetchImages(base); sourceDetails++; report.details++; } if (!images.length) { report.imageFailures++; report.skipped++; const prev = existing.get(base.id); if (prev) existing.set(base.id, { ...prev, updatedAt: base.updatedAt }); continue; } const offer = await calculateOffer({ ...base, images, firstSeenAt: existing.get(base.id)?.firstSeenAt || base.firstSeenAt }); existing.has(offer.id) ? report.updated++ : report.imported++; existing.set(offer.id, offer); }
          cursor = fetched.nextCursor; if (fetched.finished && !cursor) { sourceExhausted = true; break; }
        } while (cursor);
        scan.pagesProcessed += page; scan.offersSeen += seen.size; const previousSourceCount = [...existing.values()].filter((o) => o.sourceId === source.sourceId).length; const sane = seen.size > 0 && !(previousSourceCount >= 10000 && seen.size <= 100); sourceOk = true; const partialScan = Boolean(cursor) || stoppedByLimit; const staleEligible = sourceExhausted && !stoppedByLimit && sane; scan.cursor = staleEligible ? null : cursor; scan.status = staleEligible ? "completed" : "running"; if (staleEligible) scan.lastCompletedAt = new Date().toISOString(); await writeDataJson(`catalog/scans/${source.sourceId}.json`, scan); report.sources.push({ sourceId: source.sourceId, scanCycleId: scan.scanCycleId, ok: true, seen: seen.size, cursor, sourceExhausted, stoppedByLimit, partialScan, staleEligible }); await updatePolicyAfterRun(source, { ...lastHealth, ok: true }, staleEligible ? null : cursor);
      } catch (e: any) { lastHealth = { ok: false, message: e?.message || "import_failed", checkedAt: new Date().toISOString(), blocked: Boolean(e?.blocked), httpStatus: e?.status }; report.sources.push({ sourceId: source.sourceId, ok: false, error: lastHealth.message }); await writeDataJson(`catalog/scans/${source.sourceId}.json`, { ...(scan || {}), status: "failed", cursor, failedAt: new Date().toISOString(), lastError: lastHealth.message }); await updatePolicyAfterRun(source, lastHealth, cursor || null); }
      await writeDataJson(`catalog/health/${source.sourceId}.json`, lastHealth);
      if (sourceOk && sourceExhausted && !stoppedByLimit && seen.size > 0) { const previousSourceCount = [...existing.values()].filter((o) => o.sourceId === source.sourceId).length; if (!(previousSourceCount >= 10000 && seen.size <= 100)) { const graceMs = Number(process.env.CATALOG_STALE_GRACE_MS || 86_400_000); const now = Date.now(); for (const offer of existing.values()) if (offer.sourceId === source.sourceId && (offer.operational as any)?.lastSeenScanCycleId !== scan.scanCycleId && now - Date.parse(offer.updatedAt) > graceMs) { offer.status = "stale"; report.expired++; } } }
    }
    await persistCatalogOffers([...existing.values()] as VehicleOffer[]); await writeDataJson(`catalog/imports/${startedAt.replace(/[:.]/g,"-")}.json`, report); return report;
  } finally { await writeDataJson("catalog/import-lock.json", { operationId, lockedUntil: "", finishedAt: new Date().toISOString() }); }
}
