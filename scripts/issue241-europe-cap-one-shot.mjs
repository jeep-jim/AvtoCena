import crypto from "node:crypto";
import fs from "node:fs/promises";

const { mutateDataJson } = await import("../apps/web/lib/data.ts");
const { persistCatalogOffers, readMarketOffers } = await import("../apps/web/lib/catalog/storage.ts");
const { credibleCatalogImages, hasCredibleOfferContent, isCatalogOfferBusinessLiquid, isCatalogYearAllowed } = await import("../apps/web/lib/catalog/offer-quality.ts");
const { normalizeVehicleOfferSpecs } = await import("../apps/web/lib/catalog/spec-normalization.ts");
const { enrichOfferWithVehicleKnowledge } = await import("../apps/web/lib/catalog/vehicle-knowledge.ts");
const { PUBLIC_CATALOG_MARKETS } = await import("../apps/web/lib/catalog/runtime-config.ts");
const { CATALOG_MAX_OFFERS_PER_MODEL_YEAR, catalogModelYearQuotaKey } = await import("../apps/web/lib/catalog/inventory-quota.ts");

const market = "europe";
const expectedBefore = 3604;
const expectedAfter = 3601;
const expectedBucket = "europe|mercedes-benz|benz|2020";
const expectedRejectedIds = new Set([
  "8408cab3872e99690c2f371a",
  "832ae9f292172221aa6d6b70",
  "ca61c88592911c1f4099b5a6",
]);
const preferredMaxRub = 8_000_000;
const output = String(process.env.ISSUE241_EUROPE_CAP_REPORT || "issue241-europe-cap-correction.json");
const lockPath = "catalog/import-lock.json";
const operationId = `issue241_europe_cap_${crypto.randomUUID()}`;
const waitMs = Math.max(0, Number(process.env.CATALOG_PUBLISH_LOCK_WAIT_MS || 7_200_000));
const pollMs = Math.max(1_000, Number(process.env.CATALOG_PUBLISH_LOCK_POLL_MS || 15_000));
const ttlMs = Math.max(30 * 60_000, Number(process.env.CATALOG_PUBLISH_LOCK_TTL_MS || 90 * 60_000));
let lockHeld = false;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
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
        return { operationId, operationType: "issue241_europe_cap", lockedUntil: new Date(Date.now() + ttlMs).toISOString(), startedAt: new Date().toISOString() };
      });
      lockHeld = true;
      return;
    } catch (error) {
      last = String(error?.message || error);
      if (!/catalog_(?:publish|import|certified_power)_locked/i.test(last) || Date.now() + pollMs > deadline) throw new Error(`issue241_europe_cap_lock_wait_failed:${last}`);
      console.log(`[issue241-europe-cap] waiting: ${last}`);
      await sleep(pollMs);
    }
  }
}
async function releaseLock() {
  if (!lockHeld) return;
  await mutateDataJson(lockPath, { lockedUntil: "" }, (current) => current?.operationId === operationId
    ? { operationId, operationType: "issue241_europe_cap", lockedUntil: "", finishedAt: new Date().toISOString() }
    : current);
  lockHeld = false;
}
function freshness(offer) { return Date.parse(String(offer?.operational?.sourcePublishedAt || offer?.updatedAt || offer?.firstSeenAt || "")) || 0; }
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
function maxQuota(rows, targetMarket) {
  const counts = new Map();
  for (const offer of rows) {
    const key = catalogModelYearQuotaKey(offer, targetMarket);
    if (key) counts.set(key, Number(counts.get(key) || 0) + 1);
  }
  return counts.size ? Math.max(...counts.values()) : 0;
}

await acquireLock();
try {
  const beforeRows = {};
  const beforeCounts = {};
  for (const m of PUBLIC_CATALOG_MARKETS) {
    const rows = await readMarketOffers(m);
    beforeRows[m] = rows;
    beforeCounts[m] = rows.length;
    if (m !== market) {
      if (maxQuota(rows, m) > CATALOG_MAX_OFFERS_PER_MODEL_YEAR) throw new Error(`preflight_other_market_quota:${m}:${maxQuota(rows, m)}`);
      const badYear = rows.find((offer) => !isCatalogYearAllowed(offer?.year, m));
      if (badYear) throw new Error(`preflight_other_market_year:${m}:${badYear.id}`);
    }
  }
  if (beforeCounts[market] !== expectedBefore) throw new Error(`europe_before_drift:${beforeCounts[market]}:${expectedBefore}`);

  const normalized = await Promise.all(beforeRows[market].map(async (raw) => normalizeVehicleOfferSpecs({
    ...await enrichOfferWithVehicleKnowledge(raw),
    status: "active",
    images: credibleCatalogImages(raw?.images || []).slice(0, 30),
  })));
  const rejectedQuality = [];
  const candidates = [];
  for (const offer of normalized) {
    const ok = offer?.id
      && offer?.market === market
      && offer?.make
      && offer?.model
      && isCatalogYearAllowed(offer?.year, market)
      && isCatalogOfferBusinessLiquid(offer)
      && hasCredibleOfferContent({ ...offer, status: "active" });
    if (ok) candidates.push(offer); else rejectedQuality.push(offer);
  }
  if (rejectedQuality.length) throw new Error(`unexpected_europe_quality_removal:${rejectedQuality.length}`);
  candidates.sort(quality);

  const bucketCounts = new Map();
  for (const offer of candidates) {
    const key = catalogModelYearQuotaKey(offer, market);
    if (key) bucketCounts.set(key, Number(bucketCounts.get(key) || 0) + 1);
  }
  const overCap = [...bucketCounts.entries()].filter(([, count]) => count > CATALOG_MAX_OFFERS_PER_MODEL_YEAR);
  if (overCap.length !== 1 || overCap[0][0] !== expectedBucket || overCap[0][1] !== 23) {
    throw new Error(`unexpected_europe_overcap:${JSON.stringify(overCap)}`);
  }

  const selected = [];
  const selectedCounts = new Map();
  const rejectedQuota = [];
  for (const offer of candidates) {
    const key = catalogModelYearQuotaKey(offer, market);
    if (!key) throw new Error(`missing_quota_key:${offer.id}`);
    const count = Number(selectedCounts.get(key) || 0);
    if (count >= CATALOG_MAX_OFFERS_PER_MODEL_YEAR) { rejectedQuota.push(offer); continue; }
    selectedCounts.set(key, count + 1);
    selected.push(offer);
  }
  if (selected.length !== expectedAfter || rejectedQuota.length !== 3) throw new Error(`unexpected_europe_selection:${selected.length}:${rejectedQuota.length}`);
  const rejectedIds = new Set(rejectedQuota.map((offer) => String(offer.id)));
  if (rejectedIds.size !== expectedRejectedIds.size || [...expectedRejectedIds].some((id) => !rejectedIds.has(id))) {
    throw new Error(`unexpected_rejected_ids:${JSON.stringify([...rejectedIds])}`);
  }
  if (Math.max(0, ...selectedCounts.values()) > CATALOG_MAX_OFFERS_PER_MODEL_YEAR) throw new Error("selected_still_over_cap");

  const combined = [];
  for (const m of PUBLIC_CATALOG_MARKETS) combined.push(...(m === market ? selected : beforeRows[m]));
  process.env.CATALOG_GROW_ONLY_MARKETS = "";
  const manifest = await persistCatalogOffers(combined);

  const afterCounts = {};
  const failures = [];
  for (const m of PUBLIC_CATALOG_MARKETS) {
    const rows = await readMarketOffers(m);
    afterCounts[m] = rows.length;
    if (m === market) {
      if (rows.length !== expectedAfter) failures.push(`europe_count:${rows.length}:${expectedAfter}`);
    } else if (rows.length !== beforeCounts[m]) failures.push(`preservation_count:${m}:${beforeCounts[m]}:${rows.length}`);
    const max = maxQuota(rows, m);
    if (max > CATALOG_MAX_OFFERS_PER_MODEL_YEAR) failures.push(`quota:${m}:${max}`);
    const badYear = rows.find((offer) => !isCatalogYearAllowed(offer?.year, m));
    if (badYear) failures.push(`year:${m}:${badYear.id}`);
    if (rows.length !== Number(manifest?.markets?.[m]?.count || 0)) failures.push(`manifest_count:${m}:${rows.length}:${Number(manifest?.markets?.[m]?.count || 0)}`);
  }
  const report = {
    version: 1,
    operation: "issue241_europe_exact_model_year_cap",
    generationId: manifest.generationId,
    beforeCounts,
    afterCounts,
    europe: {
      before: expectedBefore,
      after: expectedAfter,
      overCapBucket: expectedBucket,
      removedByQuality: rejectedQuality.length,
      removedByQuota: rejectedQuota.map((offer) => ({ id: offer.id, sourceId: offer.sourceId, make: offer.make, model: offer.model, year: offer.year, totalRub: offer.totalRub, images: offer.images?.length || 0 })),
      maxAfter: Math.max(0, ...selectedCounts.values()),
    },
    failures,
  };
  await fs.writeFile(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (failures.length) throw new Error(`postpublish_failures:${failures.join("|")}`);
} finally {
  await releaseLock();
}
