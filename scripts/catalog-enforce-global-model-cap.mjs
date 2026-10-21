import crypto from "node:crypto";
import fs from "node:fs/promises";

const { mutateDataJson } = await import("../apps/web/lib/data.ts");
const { persistCatalogOffers, readMarketOffers } = await import("../apps/web/lib/catalog/storage.ts");
const { credibleCatalogImages, hasCredibleOfferContent, isCatalogOfferBusinessLiquid, isCatalogYearAllowed } = await import("../apps/web/lib/catalog/offer-quality.ts");
const { normalizeVehicleOfferSpecs } = await import("../apps/web/lib/catalog/spec-normalization.ts");
const { enrichOfferWithKnowledgeCore } = await import("../apps/web/lib/catalog/knowledge-core.ts");
const { PUBLIC_CATALOG_MARKETS } = await import("../apps/web/lib/catalog/runtime-config.ts");
const { CATALOG_MAX_OFFERS_PER_MODEL_YEAR, catalogModelYearQuotaKey, catalogExactModelKey } = await import("../apps/web/lib/catalog/inventory-quota.ts");
const preferredMaxRub = Math.max(500_000, Number(process.env.RECOVERY_PREFERRED_MAX_RUB || 8_000_000));
const output = String(process.env.CATALOG_GLOBAL_MODEL_CAP_REPORT || "catalog-global-model-cap-report.json");
const dryRun = /^(?:1|true|yes)$/i.test(String(process.env.CATALOG_GLOBAL_MODEL_CAP_DRY_RUN || ""));
const allowedEmptyMarkets = new Set(
  String(process.env.CATALOG_ALLOW_EMPTY_MARKETS || "")
    .split(",")
    .map((value) => value.trim())
    .filter((value) => PUBLIC_CATALOG_MARKETS.includes(value)),
);
const lockPath = "catalog/import-lock.json";
const operationId = `catalog_global_model_cap_${crypto.randomUUID()}`;
const waitMs = Math.max(0, Number(process.env.CATALOG_PUBLISH_LOCK_WAIT_MS || 7_200_000));
const pollMs = Math.max(1_000, Number(process.env.CATALOG_PUBLISH_LOCK_POLL_MS || 15_000));
const ttlMs = Math.max(30 * 60_000, Number(process.env.CATALOG_PUBLISH_LOCK_TTL_MS || 90 * 60_000));
let lockHeld = false;

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
async function acquireLock() {
  const deadline = Date.now() + waitMs;
  let last = "catalog_import_locked";
  while (true) {
    try {
      await mutateDataJson(lockPath, { lockedUntil: "" }, (current) => {
        const lockedUntil = Date.parse(String(current?.lockedUntil || ""));
        if (Number.isFinite(lockedUntil) && lockedUntil > Date.now() && current?.operationId !== operationId) {
          throw new Error(`catalog_import_locked_until_${new Date(lockedUntil).toISOString()}`);
        }
        return {
          operationId,
          operationType: "global_model_cap",
          lockedUntil: new Date(Date.now() + ttlMs).toISOString(),
          startedAt: new Date().toISOString(),
        };
      });
      lockHeld = true;
      return;
    } catch (error) {
      last = String(error?.message || error);
      if (!/catalog_(?:publish|import|certified_power)_locked/i.test(last) || Date.now() + pollMs > deadline) {
        throw new Error(`catalog_global_model_cap_lock_wait_failed:${last}`);
      }
      console.log(`[global-model-cap] waiting: ${last}`);
      await sleep(pollMs);
    }
  }
}
async function releaseLock() {
  if (!lockHeld) return;
  await mutateDataJson(lockPath, { lockedUntil: "" }, (current) => current?.operationId === operationId
    ? { operationId, operationType: "global_model_cap", lockedUntil: "", finishedAt: new Date().toISOString() }
    : current);
  lockHeld = false;
}

function freshness(offer) {
  return Date.parse(String(offer?.operational?.sourcePublishedAt || offer?.updatedAt || offer?.firstSeenAt || "")) || 0;
}
function quality(a, b) {
  const ap = Number(a?.totalRub || 0) > 0 && Number(a.totalRub) <= preferredMaxRub ? 0 : 1;
  const bp = Number(b?.totalRub || 0) > 0 && Number(b.totalRub) <= preferredMaxRub ? 0 : 1;
  return ap - bp
    || Number(b?.year || 0) - Number(a?.year || 0)
    || freshness(b) - freshness(a)
    || Number(b?.images?.length || 0) - Number(a?.images?.length || 0)
    || Number(a?.totalRub || Number.MAX_SAFE_INTEGER) - Number(b?.totalRub || Number.MAX_SAFE_INTEGER)
    || String(a?.id || "").localeCompare(String(b?.id || ""));
}
function normalizeVisible(raw) {
  return normalizeVehicleOfferSpecs({
    ...raw,
    status: "active",
    images: credibleCatalogImages(raw?.images || []).slice(0, 30),
  });
}
async function selectMarket(rows, market) {
  const rejected = { quality: 0, modelYearQuota: 0 };
  const candidates = (await Promise.all(rows.map(async (raw) => normalizeVisible(await enrichOfferWithKnowledgeCore(raw)))))
    .filter((offer) => {
      const ok = offer?.id
        && offer?.market === market
        && offer?.make
        && offer?.model
        && isCatalogYearAllowed(offer?.year, market)
        && isCatalogOfferBusinessLiquid(offer)
        && hasCredibleOfferContent({ ...offer, status: "active" });
      if (!ok) rejected.quality += 1;
      return Boolean(ok);
    })
    .sort(quality);
  const counts = new Map();
  const selected = [];
  for (const offer of candidates) {
    const key = catalogModelYearQuotaKey(offer, market);
    if (!key) { rejected.quality += 1; continue; }
    const count = Number(counts.get(key) || 0);
    if (count >= CATALOG_MAX_OFFERS_PER_MODEL_YEAR) { rejected.modelYearQuota += 1; continue; }
    counts.set(key, count + 1);
    selected.push(offer);
  }
  return { selected, rejected, distinctModels: new Set(selected.map((offer) => catalogExactModelKey(offer, market)).filter(Boolean)).size, distinctModelYears: counts.size, maxPerExactModelYear: counts.size ? Math.max(...counts.values()) : 0 };
}

await acquireLock();
try {
  const combined = [];
  const beforeByMarket = {};
  const selectedByMarket = {};
  const statsByMarket = {};
  for (const market of PUBLIC_CATALOG_MARKETS) {
    const rows = await readMarketOffers(market);
    beforeByMarket[market] = rows.length;
    const result = await selectMarket(rows, market);
    if (rows.length && !result.selected.length && !allowedEmptyMarkets.has(market)) {
      throw new Error(`catalog_global_model_cap_empty:${market}`);
    }
    selectedByMarket[market] = result.selected.length;
    statsByMarket[market] = {
      before: rows.length,
      selected: result.selected.length,
      removedByQuality: result.rejected.quality,
      removedByModelYearQuota: result.rejected.modelYearQuota,
      allowedEmpty: allowedEmptyMarkets.has(market),
      distinctModels: result.distinctModels,
      distinctModelYears: result.distinctModelYears,
      maxPerExactModelYear: result.maxPerExactModelYear,
    };
    combined.push(...result.selected);
  }

  if (dryRun) {
    const report = {
      version: 3,
      mode: "global_model_cap_dry_run",
      dryRun: true,
      postEnrichmentQuota: true,
      maxOffersPerModelYear: CATALOG_MAX_OFFERS_PER_MODEL_YEAR,
      preferredMaxRub,
      allowedEmptyMarkets: [...allowedEmptyMarkets],
      beforeByMarket,
      selectedByMarket,
      byMarket: statsByMarket,
    };
    await fs.writeFile(output, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } else {
    process.env.CATALOG_GROW_ONLY_MARKETS = "";
    const manifest = await persistCatalogOffers(combined);
    const afterByMarket = {};
    const failures = [];
    for (const market of PUBLIC_CATALOG_MARKETS) {
      const rows = await readMarketOffers(market);
      afterByMarket[market] = rows.length;
      const counts = new Map();
      for (const offer of rows) {
        const key = catalogModelYearQuotaKey(offer, market);
        if (key) counts.set(key, Number(counts.get(key) || 0) + 1);
        if (!isCatalogYearAllowed(offer?.year, market)) failures.push(`${market}:year:${offer?.id}`);
      }
      const max = counts.size ? Math.max(...counts.values()) : 0;
      if (max > CATALOG_MAX_OFFERS_PER_MODEL_YEAR) failures.push(`${market}:model_year_quota:${max}`);
      if (rows.length !== Number(manifest?.markets?.[market]?.count || 0)) failures.push(`${market}:manifest_count:${rows.length}:${Number(manifest?.markets?.[market]?.count || 0)}`);
      if (rows.length === 0 && !allowedEmptyMarkets.has(market)) failures.push(`${market}:unexpected_empty_after_publish`);
    }
    const report = {
      version: 3,
      mode: "global_model_cap_publish",
      published: true,
      postEnrichmentQuota: true,
      generationId: manifest.generationId,
      maxOffersPerModelYear: CATALOG_MAX_OFFERS_PER_MODEL_YEAR,
      preferredMaxRub,
      allowedEmptyMarkets: [...allowedEmptyMarkets],
      beforeByMarket,
      selectedByMarket,
      afterByMarket,
      byMarket: statsByMarket,
      failures,
    };
    await fs.writeFile(output, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    if (failures.length) process.exitCode = 1;
  }
} finally {
  await releaseLock();
}
