import crypto from "node:crypto";
import fs from "node:fs/promises";

const { mutateDataJson } = await import("../apps/web/lib/data.ts");
const { persistCatalogOffers, readMarketOffers } = await import("../apps/web/lib/catalog/storage.ts");
const { credibleCatalogImages, isCatalogOfferBusinessLiquid, catalogMinYearForMarket, isCatalogYearAllowed } = await import("../apps/web/lib/catalog/offer-quality.ts");
const { normalizeVehicleOfferSpecs } = await import("../apps/web/lib/catalog/spec-normalization.ts");
const { isPreliminaryElectrifiedCalculation } = await import("../apps/web/lib/catalog/customs-pricing.ts");
const { PUBLIC_CATALOG_MARKETS, CATALOG_RETENTION_MS, CATALOG_MAX_PUBLIC_OFFERS_PER_MARKET } = await import("../apps/web/lib/catalog/runtime-config.ts");

const market = String(process.env.RECOVERY_PUBLISH_MARKET || "").trim();
const input = String(process.env.RECOVERY_PUBLISH_INPUT || `catalog-rebuild-${market}.json`).trim();
const output = String(process.env.RECOVERY_PUBLISH_REPORT || `catalog-live-recovery-${market}-publish-report.json`).trim();
const maxPerMarket = Math.max(1, Math.min(CATALOG_MAX_PUBLIC_OFFERS_PER_MARKET || 100_000, Number(process.env.RECOVERY_PUBLISH_MAX || CATALOG_MAX_PUBLIC_OFFERS_PER_MARKET || 100_000)));
const preferredMaxRub = Math.max(500_000, Number(process.env.RECOVERY_PREFERRED_MAX_RUB || 8_000_000));
const maxOffersPerModel = Math.max(1, Math.min(1_000, Number(process.env.CATALOG_MAX_OFFERS_PER_MODEL || 20)));
const retentionMs = Math.max(60 * 60 * 1_000, Number(process.env.CATALOG_OFFER_RETENTION_MS || CATALOG_RETENTION_MS || 259_200_000));
const retentionCutoff = Date.now() - retentionMs;
const minYear = catalogMinYearForMarket(market);
const publishLockPath = "catalog/import-lock.json";
const publishOperationId = `catalog_recovery_publish_${market}_${crypto.randomUUID()}`;
const publishLockWaitMs = Math.max(0, Number(process.env.CATALOG_PUBLISH_LOCK_WAIT_MS || 7_200_000));
const publishLockPollMs = Math.max(1_000, Number(process.env.CATALOG_PUBLISH_LOCK_POLL_MS || 15_000));
const publishLockTtlMs = Math.max(30 * 60_000, Number(process.env.CATALOG_PUBLISH_LOCK_TTL_MS || 90 * 60_000));
let publishLockHeld = false;

if (!PUBLIC_CATALOG_MARKETS.includes(market)) throw new Error(`recovery_publish_market_invalid:${market}`);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquirePublishLock() {
  const deadline = Date.now() + publishLockWaitMs;
  let lastLock = "catalog_publish_locked";
  while (true) {
    try {
      await mutateDataJson(publishLockPath, { lockedUntil: "" }, (current) => {
        const lockedUntil = Date.parse(String(current?.lockedUntil || ""));
        if (Number.isFinite(lockedUntil) && lockedUntil > Date.now() && current?.operationId !== publishOperationId) {
          throw new Error(`catalog_publish_locked_until_${new Date(lockedUntil).toISOString()}`);
        }
        return {
          operationId: publishOperationId,
          operationType: `recovery_publish_${market}`,
          lockedUntil: new Date(Date.now() + publishLockTtlMs).toISOString(),
          startedAt: new Date().toISOString(),
        };
      });
      publishLockHeld = true;
      return;
    } catch (error) {
      lastLock = String(error?.message || error);
      if (!/catalog_(?:publish|import|certified_power)_locked/i.test(lastLock) || Date.now() + publishLockPollMs > deadline) {
        throw new Error(`catalog_publish_lock_wait_failed:${lastLock}`);
      }
      console.log(`[publish-lock] ${market} waiting: ${lastLock}`);
      await sleep(publishLockPollMs);
    }
  }
}

async function releasePublishLock() {
  if (!publishLockHeld) return;
  await mutateDataJson(publishLockPath, { lockedUntil: "" }, (current) => current?.operationId === publishOperationId
    ? { operationId: publishOperationId, operationType: `recovery_publish_${market}`, lockedUntil: "", finishedAt: new Date().toISOString() }
    : current);
  publishLockHeld = false;
}

function exactCalculation(offer) {
  const total = Number(offer?.totalRub || 0);
  const customs = offer?.calculationSnapshot?.customs;
  const breakdown = offer?.calculationSnapshot?.breakdown;
  if (!(total > 0) || customs?.status !== "ready" || !Number.isFinite(Number(customs?.totalCustomsRub))) return false;
  if (!Array.isArray(breakdown) || !breakdown.some((line) => line?.id === "car") || !breakdown.some((line) => line?.id === "customs")) return false;
  const kind = String(offer?.powertrainKind || "");
  if (!["electric", "series_hybrid", "other_hybrid"].includes(kind)) return Number(offer?.engineCc || 0) > 0 && Number(offer?.powerHp || 0) > 0;
  if (Number(offer?.utilizationPowerKw || 0) > 0) return true;
  const motor30 = Number(offer?.power30MinKw || 0) || (Array.isArray(offer?.power30MinKwByMotor) ? offer.power30MinKwByMotor.reduce((sum, value) => sum + Math.max(0, Number(value || 0)), 0) : 0);
  return kind === "other_hybrid" ? motor30 > 0 && Number(offer?.icePowerKw || 0) > 0 : motor30 > 0;
}
function publishableCalculation(offer) {
  return exactCalculation(offer) || isPreliminaryElectrifiedCalculation(offer);
}
function exactSourceBound(offer) {
  const op = offer?.operational || {};
  const raw = op?.raw || {};
  return /^https?:\/\//i.test(String(op.sourceUrl || ""))
    && Number(offer?.sourcePrice || 0) > 0
    && Boolean(String(offer?.sourceCurrency || "").trim())
    && raw.recoveryExactSourceUrl === true
    && raw.recoveryExactPhotoIdentity === true
    && raw.recoveryCalculatedRub === true
    && raw.recoveryBodySourceOnly === true;
}
function publicExistingStillValid(offer) {
  return /^https?:\/\//i.test(String(offer?.operational?.sourceUrl || ""))
    && Number(offer?.sourcePrice || 0) > 0
    && Boolean(String(offer?.sourceCurrency || "").trim())
    && publishableCalculation(offer)
    && isCatalogOfferBusinessLiquid(offer);
}
function freshness(offer) {
  return Date.parse(String(offer?.operational?.sourcePublishedAt || offer?.updatedAt || offer?.firstSeenAt || "")) || 0;
}
function withinRetention(offer) {
  const timestamp = freshness(offer);
  return timestamp > 0 && timestamp >= retentionCutoff;
}
function normalizeVisible(raw) {
  const op = raw?.operational || {};
  const sourceRaw = op?.raw || {};
  const exactPhoto = sourceRaw.recoveryExactPhotoIdentity === true;
  return normalizeVehicleOfferSpecs({
    ...raw,
    status: "active",
    images: credibleCatalogImages(raw?.images || []).slice(0, 30),
    operational: {
      ...op,
      ...(exactPhoto ? { photoIdentityVerified: true } : {}),
      raw: {
        ...sourceRaw,
        ...(exactPhoto ? { photoIdentityVerified: true, listingBoundImages: true } : {}),
      },
    },
  });
}
function quality(a, b) {
  const ap = Number(a.totalRub || 0) <= preferredMaxRub ? 0 : 1;
  const bp = Number(b.totalRub || 0) <= preferredMaxRub ? 0 : 1;
  return ap - bp
    || Number(b.year || 0) - Number(a.year || 0)
    || freshness(b) - freshness(a)
    || Number(b.images?.length || 0) - Number(a.images?.length || 0)
    || Number(a.totalRub || Number.MAX_SAFE_INTEGER) - Number(b.totalRub || Number.MAX_SAFE_INTEGER)
    || String(a.id || "").localeCompare(String(b.id || ""));
}
function makeKey(offer) { return String(offer?.make || "").trim().toLowerCase().replace(/\s+/g, " "); }
function modelKey(offer) {
  const make = makeKey(offer);
  const model = String(offer?.model || "").trim().toLowerCase().replace(/\s+/g, " ");
  return make && model ? `${make}|${model}` : "";
}

function applyPerModelCap(rows, rejected) {
  const result = [];
  const modelCounts = new Map();
  for (const offer of rows) {
    const key = modelKey(offer);
    const count = key ? Number(modelCounts.get(key) || 0) : 0;
    if (key && count >= maxOffersPerModel) {
      rejected.model_quota = Number(rejected.model_quota || 0) + 1;
      continue;
    }
    result.push(offer);
    if (key) modelCounts.set(key, count + 1);
    if (result.length >= maxPerMarket) break;
  }
  return { rows: result, modelCounts };
}

const payload = JSON.parse(await fs.readFile(input, "utf8"));
const sourceRows = Array.isArray(payload?.offers) ? payload.offers : [];
const rejected = {};
function reject(reason) { rejected[reason] = Number(rejected[reason] || 0) + 1; }

const incoming = new Map();
for (const raw of sourceRows) {
  const offer = normalizeVisible(raw);
  if (!offer?.id || incoming.has(offer.id)) continue;
  if (offer.market !== market) { reject("market"); continue; }
  const year = Number(offer.year || 0);
  if (!isCatalogYearAllowed(year, market)) { reject("year"); continue; }
  if (!isCatalogOfferBusinessLiquid(offer)) { reject("business_liquidity"); continue; }
  if (!offer.make || !offer.model || !offer.images.length) { reject("visible_core"); continue; }
  if (!exactSourceBound(offer)) { reject("source_binding"); continue; }
  if (!publishableCalculation(offer)) { reject("calculation"); continue; }
  incoming.set(offer.id, offer);
}

await acquirePublishLock();
try {
let previousMarket = [];
try { previousMarket = await readMarketOffers(market); } catch { previousMarket = []; }
const candidates = new Map();
for (const raw of previousMarket) {
  const offer = normalizeVisible(raw);
  const year = Number(offer?.year || 0);
  if (!offer?.id || !["active", "stale"].includes(String(raw?.status || ""))) continue;
  if (!isCatalogYearAllowed(year, market) || !offer.make || !offer.model || !offer.images.length) continue;
  if (!withinRetention(offer) || !publicExistingStillValid(offer)) continue;
  candidates.set(offer.id, offer);
}
for (const [id, offer] of incoming) candidates.set(id, offer);

const cumulative = [...candidates.values()].sort(quality);
const diversity = applyPerModelCap(cumulative, rejected);
const marketRows = diversity.rows;
if (!marketRows.length) {
  const report = { version: 2, mode: "live_market_exact_calculated_cumulative_publish", market, published: false, generationId: null, count: 0, retainedCount: 0, incomingCount: incoming.size, rejected, publicationError: `recovery_empty_market:${market}` };
  await fs.writeFile(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  throw new Error(`recovery_empty_market:${market}`);
}

const combined = [...marketRows];
const preservedByMarket = {};
for (const other of PUBLIC_CATALOG_MARKETS) {
  if (other === market) continue;
  let rows = [];
  try { rows = await readMarketOffers(other); } catch { rows = []; }
  const preserved = rows
    .filter((offer) => ["active", "stale"].includes(String(offer?.status || "")))
    .map(normalizeVisible)
    .filter((offer) => offer.id && offer.make && offer.model && isCatalogYearAllowed(offer.year, other) && offer.images.length > 0 && withinRetention(offer) && isCatalogOfferBusinessLiquid(offer))
    .slice(0, CATALOG_MAX_PUBLIC_OFFERS_PER_MARKET || 100_000);
  preservedByMarket[other] = preserved.length;
  combined.push(...preserved);
}
const unique = new Map();
for (const offer of combined) if (offer?.id && !unique.has(offer.id)) unique.set(offer.id, offer);

let manifest = null;
let publicationError = "";
try {
  process.env.CATALOG_GROW_ONLY_MARKETS = "";
  manifest = await persistCatalogOffers([...unique.values()]);
} catch (error) {
  publicationError = String(error?.message || error);
}

const postPersistByMarket = {};
let postPersistError = "";
if (manifest) {
  try {
    for (const currentMarket of PUBLIC_CATALOG_MARKETS) {
      postPersistByMarket[currentMarket] = (await readMarketOffers(currentMarket)).length;
    }
  } catch (error) {
    postPersistError = String(error?.message || error);
  }
}

const currentIncomingIds = new Set(incoming.keys());
const report = {
  version: 2,
  mode: "live_market_exact_calculated_cumulative_publish",
  market,
  publishedAt: new Date().toISOString(),
  published: Boolean(manifest),
  generationId: manifest?.generationId || null,
  count: marketRows.length,
  postPersistCount: Object.prototype.hasOwnProperty.call(postPersistByMarket, market) ? postPersistByMarket[market] : null,
  postPersistByMarket,
  postPersistError,
  incomingCount: incoming.size,
  retainedCount: marketRows.filter((offer) => !currentIncomingIds.has(offer.id)).length,
  refreshedOrNewCount: marketRows.filter((offer) => currentIncomingIds.has(offer.id)).length,
  preferredCount: marketRows.filter((offer) => Number(offer.totalRub || 0) <= preferredMaxRub).length,
  calculatedCount: marketRows.filter(exactCalculation).length,
  preliminaryCount: marketRows.filter(isPreliminaryElectrifiedCalculation).length,
  minYear,
  retentionMs,
  preferredMaxRub,
  maxOffersPerModel,
  distinctModels: diversity.modelCounts.size,
  distinctMakes: new Set(marketRows.map(makeKey)).size,
  sourceCounts: Object.fromEntries([...new Set(marketRows.map((offer) => String(offer.sourceId || "unknown")))].map((sourceId) => [sourceId, marketRows.filter((offer) => String(offer.sourceId || "unknown") === sourceId).length])),
  imageStats: {
    min: Math.min(...marketRows.map((offer) => offer.images.length)),
    max: Math.max(...marketRows.map((offer) => offer.images.length)),
    average: Number((marketRows.reduce((sum, offer) => sum + offer.images.length, 0) / marketRows.length).toFixed(2)),
  },
  preservedByMarket,
  rejected,
  publicationError,
};
await fs.writeFile(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (!manifest || publicationError) process.exitCode = 1;
} finally {
  await releasePublishLock();
}
