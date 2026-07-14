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
      let cursor: string | null | undefined = policy.lastSuccessfulCursor || null; let page = 0; const seen = new Set<string>(); let sourceOk = false; let lastHealth: any = { ok: true, message: "ok", checkedAt: new Date().toISOString() };
      try {
        do { page++; if (page > policy.maxPagesPerRun || seen.size >= policy.maxOffersPerRun) break; const fetched: any = await source.fetchPage(cursor); lastHealth = fetched.health || lastHealth;
          for (const raw of fetched.items.slice(0, policy.maxOffersPerRun - seen.size)) { const base = source.normalizeOffer(raw); if (!base) { report.skipped++; continue; } let images: any[] = []; if (policy.imagesEnabled && report.details < policy.maxDetailsPerRun) { images = await source.fetchImages(base); report.details++; } if (!images.length) { report.imageFailures++; report.skipped++; continue; } const offer = await calculateOffer({ ...base, images, firstSeenAt: existing.get(base.id)?.firstSeenAt || base.firstSeenAt }); seen.add(offer.id); existing.has(offer.id) ? report.updated++ : report.imported++; existing.set(offer.id, offer); }
          cursor = fetched.nextCursor; if (fetched.finished) break;
        } while (cursor);
        sourceOk = true; report.sources.push({ sourceId: source.sourceId, ok: true, seen: seen.size, cursor }); await updatePolicyAfterRun(source, { ...lastHealth, ok: true }, cursor || null);
      } catch (e: any) { lastHealth = { ok: false, message: e?.message || "import_failed", checkedAt: new Date().toISOString(), blocked: Boolean(e?.blocked), httpStatus: e?.status }; report.sources.push({ sourceId: source.sourceId, ok: false, error: lastHealth.message }); await updatePolicyAfterRun(source, lastHealth, cursor || null); }
      await writeDataJson(`catalog/health/${source.sourceId}.json`, lastHealth);
      if (sourceOk) { const graceMs = Number(process.env.CATALOG_STALE_GRACE_MS || 86_400_000); const now = Date.now(); for (const offer of existing.values()) if (offer.sourceId === source.sourceId && !seen.has(offer.id) && now - Date.parse(offer.updatedAt) > graceMs) { offer.status = "stale"; report.expired++; } }
    }
    await persistCatalogOffers([...existing.values()] as VehicleOffer[]); await writeDataJson(`catalog/imports/${startedAt.replace(/[:.]/g,"-")}.json`, report); return report;
  } finally { await writeDataJson("catalog/import-lock.json", { operationId, lockedUntil: "", finishedAt: new Date().toISOString() }); }
}
