import fs from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";

const { mutateDataJson } = await import("../apps/web/lib/data.ts");
const { calculateOfferWithRussiaCustoms } = await import("../apps/web/lib/catalog/customs-pricing.ts");
const { isCrediblePublicOffer, isCatalogYearAllowed, isCatalogMarketSourceAllowed } = await import("../apps/web/lib/catalog/offer-quality.ts");
const { compareCatalogPublicPriority, japanAuctionSoldIdentityVerified } = await import("../apps/web/lib/catalog/public-priority.ts");
const { classifyCatalogV2Offer, selectCatalogV2MarketOffers } = await import("../apps/web/lib/catalog/catalog-v2-policy.ts");
const { normalizeVehicleOfferSpecs } = await import("../apps/web/lib/catalog/spec-normalization.ts");
const { catalogRetentionDecision, catalogSourceRefreshStates } = await import("../apps/web/lib/catalog/source-retention.ts");
const { persistCatalogOffers, previewCanonicalPublicCatalogOffers, readAllOffersForMaintenance, readMarketOffers } = await import("../apps/web/lib/catalog/storage.ts");
const { PUBLIC_CATALOG_MARKETS } = await import("../apps/web/lib/catalog/runtime-config.ts");

const inputDir = process.env.CATALOG_REBUILD_INPUT_DIR || "catalog-v2-input";
const reportFile = process.env.CATALOG_REBUILD_PUBLISH_REPORT || "catalog-v2-market-publish-report.json";
const configuredMarkets = String(process.env.CATALOG_REBUILD_MARKETS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const market = configuredMarkets[0] || "";
const targetPerSource = Math.max(1, Number(process.env.CATALOG_REBUILD_TARGET_PER_SOURCE || 100_000));
const targetPerMarket = Math.max(1, Number(process.env.CATALOG_PUBLISH_TARGET_PER_MARKET || 100_000));
const maximumPerMarket = Math.max(targetPerMarket, Number(process.env.CATALOG_PUBLISH_MAX_PER_MARKET || 100_000));
const minimumImagesPerOffer = Math.max(1, Number(process.env.CATALOG_REBUILD_MIN_IMAGES_PER_OFFER || 1));
const defaultRetentionMs = Math.max(60_000, Number(process.env.CATALOG_DEFAULT_RETENTION_MS || 3 * 24 * 60 * 60 * 1_000));
const japanRetentionMs = Math.max(defaultRetentionMs, Number(process.env.CATALOG_JAPAN_RETENTION_MS || 30 * 24 * 60 * 60 * 1_000));
const currentRetentionOverrideMs = Math.max(0, Number(process.env.CATALOG_OFFER_RETENTION_MS || 0));
const outageGraceMultiplier = Math.max(1, Math.min(4, Number(process.env.CATALOG_SOURCE_OUTAGE_RETENTION_MULTIPLIER || 2)));
const minimumPublicRetentionRatio = Math.max(0.01, Math.min(1, Number(process.env.CATALOG_MIN_PUBLIC_RETENTION_RATIO || 0.10)));
const allowPublicCollapse = process.env.CATALOG_ALLOW_PUBLIC_COLLAPSE === "1";
const prepareConcurrency = Math.max(1, Math.min(32, Number(process.env.CATALOG_PUBLISH_PREPARE_CONCURRENCY || 16)));
const priorityMaxTotalRub = Math.max(100_000, Number(process.env.CATALOG_PRIORITY_MAX_TOTAL_RUB || 6_000_000));
const priorityMaxPowerHp = Math.max(1, Number(process.env.CATALOG_PRIORITY_MAX_POWER_HP || 160));
const priorityMaxAgeYears = Math.max(0, Number(process.env.CATALOG_PRIORITY_MAX_AGE_YEARS || 6));
const v2Policy = {
  priorityTarget: Math.max(0, Number(process.env.CATALOG_V2_PRIORITY_TARGET || 1_000)),
  maximumPerMarket,
  priorityMaxAgeYears,
  recentMaxAgeYears: Math.max(priorityMaxAgeYears, Number(process.env.CATALOG_V2_RECENT_MAX_AGE_YEARS || 10)),
  priorityMaxPowerHp,
  priorityMaxTotalRub,
  hardMaxTotalRub: Math.max(priorityMaxTotalRub, Number(process.env.CATALOG_V2_HARD_MAX_TOTAL_RUB || 100_000_000)),
  lowPowerMinShare: Math.max(0, Math.min(1, Number(process.env.CATALOG_V2_LOW_POWER_MIN_SHARE || 0.8))),
};
const COMMERCIAL_RE = /\b(?:truck|dump|tipper|bus|minibus|kei\s*truck|commercial|cargo|lorry|tractor|forklift|excavator|machinery|canter|fighter|ranger|dutro|forward|giga|elf|profia|8\s*tonne|8\s*ton)\b|(?:货车|卡车|客车|巴士|工程机械|商用车)/i;
const publishLockPath = "catalog/import-lock.json";
const publishOperationId = `catalog_v3_publish_${market}_${crypto.randomUUID()}`;
const publishLockWaitMs = Math.max(0, Number(process.env.CATALOG_PUBLISH_LOCK_WAIT_MS || 7_200_000));
const publishLockPollMs = Math.max(1_000, Number(process.env.CATALOG_PUBLISH_LOCK_POLL_MS || 15_000));
const publishLockTtlMs = Math.max(30 * 60_000, Number(process.env.CATALOG_PUBLISH_LOCK_TTL_MS || 90 * 60_000));
let publishLockHeld = false;

if (!PUBLIC_CATALOG_MARKETS.includes(market)) {
  throw new Error(`catalog_market_invalid:${market || "missing"}`);
}
if (configuredMarkets.length !== 1) {
  throw new Error(`catalog_market_scope_requires_one_market:${configuredMarkets.join(",")}`);
}

function retentionForMarket(marketId) {
  if (marketId === market && currentRetentionOverrideMs > 0) return Math.max(60_000, currentRetentionOverrideMs);
  return marketId === "japan" ? japanRetentionMs : defaultRetentionMs;
}

const retentionMs = retentionForMarket(market);

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
          operationType: `catalog_v3_publish_${market}`,
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
    ? { operationId: publishOperationId, operationType: `catalog_v3_publish_${market}`, lockedUntil: "", finishedAt: new Date().toISOString() }
    : current);
  publishLockHeld = false;
}

function imageKey(image) {
  return String(image?.checksum || image?.id || image?.objectKey || image?.url || "");
}

function uniqueImages(images) {
  const seen = new Set();
  const result = [];
  for (const image of Array.isArray(images) ? images : []) {
    const key = imageKey(image);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(image);
    if (result.length >= 30) break;
  }
  return result;
}

function freshness(offer) {
  return Date.parse(String(
    offer?.updatedAt
      || offer?.operational?.fullRebuildAt
      || offer?.operational?.sourcePublishedAt
      || offer?.firstSeenAt
      || "",
  )) || 0;
}

function stableJsonValue(value) {
  if (Array.isArray(value)) return value.map(stableJsonValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableJsonValue(value[key])]));
  }
  return value;
}

function hashRows(rows) {
  const canonical = [...rows]
    .sort((left, right) => String(left?.id || "").localeCompare(String(right?.id || "")))
    .map(stableJsonValue);
  return crypto.createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

function qualityOrder(left, right) {
  return compareCatalogPublicPriority(left, right)
    || freshness(right) - freshness(left)
    || String(left?.id || "").localeCompare(String(right?.id || ""));
}

function overlayDefined(base, overlay) {
  const result = { ...(base || {}) };
  for (const [key, value] of Object.entries(overlay || {})) {
    if (value === undefined || value === null || value === "") continue;
    result[key] = value;
  }
  return result;
}

function mergeOfferVersions(primary, retained) {
  if (!retained) return { ...primary, images: uniqueImages(primary?.images) };
  const merged = overlayDefined(retained, primary);
  const primaryRaw = typeof primary?.operational?.raw === "object" && primary.operational.raw ? primary.operational.raw : {};
  const retainedRaw = typeof retained?.operational?.raw === "object" && retained.operational.raw ? retained.operational.raw : {};
  const firstSeen = [primary?.firstSeenAt, retained?.firstSeenAt]
    .filter(Boolean)
    .sort((left, right) => Date.parse(String(left)) - Date.parse(String(right)))[0];
  const updatedAt = [primary?.updatedAt, retained?.updatedAt]
    .filter(Boolean)
    .sort((left, right) => Date.parse(String(right)) - Date.parse(String(left)))[0];
  return {
    ...merged,
    firstSeenAt: firstSeen || primary?.firstSeenAt || retained?.firstSeenAt,
    updatedAt: updatedAt || primary?.updatedAt || retained?.updatedAt,
    images: uniqueImages([...(primary?.images || []), ...(retained?.images || [])]),
    calculationSnapshot: overlayDefined(retained?.calculationSnapshot, primary?.calculationSnapshot),
    operational: {
      ...overlayDefined(retained?.operational, primary?.operational),
      raw: overlayDefined(retainedRaw, primaryRaw),
    },
  };
}

function isCommercial(offer) {
  return COMMERCIAL_RE.test(`${offer?.make || ""} ${offer?.model || ""} ${offer?.trim || ""} ${offer?.bodyType || ""}`)
    || /^(?:Hino|Mitsubishi Fuso)$/i.test(String(offer?.make || ""));
}

function hasExactCalculation(offer) {
  const customs = offer?.calculationSnapshot?.customs;
  const breakdown = offer?.calculationSnapshot?.breakdown;
  if (customs?.status !== "ready" || !Number.isFinite(Number(customs?.totalCustomsRub))) return false;
  if (!Array.isArray(breakdown) || !breakdown.some((line) => line?.id === "car") || !breakdown.some((line) => line?.id === "customs")) return false;
  const kind = String(offer?.powertrainKind || "");
  if (!["electric", "series_hybrid", "other_hybrid"].includes(kind)) return true;
  if (Number(offer?.utilizationPowerKw || 0) > 0) return true;
  const motor30Min = Number(offer?.power30MinKw || 0)
    || (Array.isArray(offer?.power30MinKwByMotor)
      ? offer.power30MinKwByMotor.reduce((sum, value) => sum + Math.max(0, Number(value || 0)), 0)
      : 0);
  return kind === "other_hybrid" ? motor30Min > 0 && Number(offer?.icePowerKw || 0) > 0 : motor30Min > 0;
}

async function generationFilesForMarket() {
  let names = [];
  try { names = await fs.readdir(inputDir); } catch { return []; }
  return names
    .filter((name) => name === `catalog-rebuild-${market}.json` || (name.startsWith(`catalog-rebuild-${market}-`) && name.endsWith(".json")))
    .map((name) => path.join(inputDir, name))
    .sort();
}

async function readGenerationFiles() {
  const filenames = await generationFilesForMarket();
  const payloads = [];
  const offers = [];
  const errors = [];
  for (const filename of filenames) {
    try {
      const parsed = JSON.parse(await fs.readFile(filename, "utf8"));
      if (!Array.isArray(parsed?.offers)) throw new Error("generation_offers_missing");
      if (parsed.market && parsed.market !== market) throw new Error(`generation_market_mismatch_${parsed.market}`);
      payloads.push(parsed);
      offers.push(...parsed.offers);
    } catch (error) {
      errors.push({ filename, error: String(error?.message || error) });
    }
  }
  return { filenames, payloads, offers, errors };
}

async function runWithConcurrency(items, concurrency, worker) {
  if (!items.length) return [];
  const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index]);
    }
  }));
  return results;
}

async function auditCandidate(sourceOffer) {
  try {
    if (!sourceOffer?.id || sourceOffer?.market !== market || isCommercial(sourceOffer)) return { offer: null, reason: "commercial_or_identity" };
    let offer = normalizeVehicleOfferSpecs({ ...sourceOffer, status: "active", images: uniqueImages(sourceOffer.images) });
    if (!offer.make || !offer.model || !Number.isFinite(Number(offer.year))) return { offer: null, reason: "specs" };
    if (!offer.operational?.sourceUrl || !Number.isFinite(Number(offer.sourcePrice)) || Number(offer.sourcePrice) <= 0) return { offer: null, reason: "source" };
    if (offer.images.length < minimumImagesPerOffer) return { offer: null, reason: "images" };
    offer = normalizeVehicleOfferSpecs(await calculateOfferWithRussiaCustoms(offer));
    const calculationStatus = String(offer.calculationStatus || "");
    const calculationPending = calculationStatus === "needs_data" || calculationStatus.startsWith("needs_");
    if (!hasExactCalculation(offer) && !calculationPending) return { offer: null, reason: "calculation" };
    if (!isCrediblePublicOffer(offer)) return { offer: null, reason: "quality" };
    if (!japanAuctionSoldIdentityVerified(offer)) return { offer: null, reason: "japan_auction_sold_identity_unverified" };
    const priority = classifyCatalogV2Offer(offer, v2Policy);
    if (!priority.eligible) return { offer: null, reason: `v2_${priority.reason}` };
    offer.operational = {
      ...(offer.operational || {}),
      raw: {
        ...(typeof offer.operational?.raw === "object" && offer.operational.raw ? offer.operational.raw : {}),
        publicPriority: priority,
      },
    };
    return { offer, reason: "ok" };
  } catch (error) {
    return { offer: null, reason: `exception:${String(error?.message || error)}` };
  }
}

await acquirePublishLock();
try {
const generation = await readGenerationFiles();
const sourceRefreshStates = catalogSourceRefreshStates(generation.payloads);
let currentMarketRows = [];
try { currentMarketRows = await readMarketOffers(market); } catch { currentMarketRows = []; }
const retentionDecisions = new Map();
const currentRetainedRows = currentMarketRows.filter((row) => {
  if (!["active", "stale"].includes(String(row?.status || ""))) return false;
  const decision = catalogRetentionDecision({
    offer: row,
    retentionMs,
    outageGraceMultiplier,
    sourceStates: sourceRefreshStates,
  });
  retentionDecisions.set(String(row.id || ""), decision);
  return decision.retain;
});
const outageProtectedCount = [...retentionDecisions.values()].filter((decision) => decision.reason === "source_outage_grace").length;
const authoritativeExpiredCount = [...retentionDecisions.values()].filter((decision) => decision.reason === "expired_after_authoritative_refresh").length;
const outageGraceExpiredCount = [...retentionDecisions.values()].filter((decision) => decision.reason === "outage_grace_expired").length;

const candidatesById = new Map();
for (const offer of currentRetainedRows
  .filter((offer) => !(market === "japan" && String(offer?.sourceId || "") === "goonet_japan_exact"))
  .sort((left, right) => freshness(left) - freshness(right))) {
  candidatesById.set(offer.id, mergeOfferVersions({ ...offer, status: "active" }, candidatesById.get(offer.id)));
}
for (const offer of generation.offers.sort((left, right) => freshness(left) - freshness(right))) {
  if (!offer?.id) continue;
  candidatesById.set(offer.id, mergeOfferVersions(offer, candidatesById.get(offer.id)));
}

const orderedCandidates = [...candidatesById.values()].sort(qualityOrder);
const selected = [];
const selectedIds = new Set();
const imageOwners = new Map();
const sourceCounts = new Map();
const rejectionReasons = {};
const selectionCandidateLimit = Math.max(maximumPerMarket, Math.min(100_000, maximumPerMarket * 3));

for (let start = 0; start < orderedCandidates.length && selected.length < selectionCandidateLimit; start += prepareConcurrency) {
  const batch = orderedCandidates.slice(start, start + prepareConcurrency);
  const audited = await runWithConcurrency(batch, prepareConcurrency, auditCandidate);
  for (const result of audited) {
    if (!result?.offer) {
      const reason = result?.reason || "unknown";
      rejectionReasons[reason] = Number(rejectionReasons[reason] || 0) + 1;
      continue;
    }
    const offer = result.offer;
    if (selectedIds.has(offer.id)) continue;
    const sourceId = String(offer.sourceId || "unknown");
    if (Number(sourceCounts.get(sourceId) || 0) >= targetPerSource) {
      rejectionReasons.source_quota = Number(rejectionReasons.source_quota || 0) + 1;
      continue;
    }
    const ownedImages = offer.images.filter((image) => {
      const key = imageKey(image);
      const owner = imageOwners.get(key);
      return !owner || owner === offer.id;
    });
    if (ownedImages.length < minimumImagesPerOffer) {
      rejectionReasons.duplicate_images = Number(rejectionReasons.duplicate_images || 0) + 1;
      continue;
    }
    offer.images = ownedImages;
    selected.push(offer);
    selectedIds.add(offer.id);
    sourceCounts.set(sourceId, Number(sourceCounts.get(sourceId) || 0) + 1);
    for (const image of ownedImages) imageOwners.set(imageKey(image), offer.id);
  }
}

// Retained rows already entered candidatesById and passed the same audit as fresh
// rows. Do not append them again after selection: that used to bypass the 80%
// low-power mix and could resurrect legacy Goonet cards with obsolete covers.
const v2Selection = selectCatalogV2MarketOffers(selected.sort(qualityOrder), v2Policy);
const selectedMarketOffersById = new Map();
for (const offer of v2Selection.selected.slice(0, maximumPerMarket)) selectedMarketOffersById.set(String(offer.id), offer);
const selectedMarketOffers = [...selectedMarketOffersById.values()].slice(0, maximumPerMarket);
const preservedByMarket = {};
const preservedPublicHashByMarket = {};
const expectedPublishedByMarket = {};
const expectedPublishedHashByMarket = {};
const preservedPublicRowsByMarket = {};

// A one-market refresh must never reconstruct the other six markets from
// retention or quality filters. Read their already-published rows and pass them
// through the exact-preservation path byte-for-byte.
for (const otherMarket of PUBLIC_CATALOG_MARKETS) {
  if (otherMarket === market) continue;
  let rows = [];
  try { rows = await readMarketOffers(otherMarket); } catch (error) {
    throw new Error(`catalog_preserved_public_read_failed:${otherMarket}:${String(error?.message || error)}`);
  }
  const invalid = rows.filter((offer) => !offer?.id || !offer?.make || !offer?.model
    || String(offer?.market || "") !== otherMarket
    || !isCatalogYearAllowed(offer?.year, otherMarket)
    || !isCatalogMarketSourceAllowed(offer)
    || !Array.isArray(offer?.images) || offer.images.length === 0);
  if (invalid.length) throw new Error(`catalog_preserved_public_gate_failed:${otherMarket}:${invalid.length}`);
  preservedByMarket[otherMarket] = rows.length;
  preservedPublicHashByMarket[otherMarket] = hashRows(rows);
  preservedPublicRowsByMarket[otherMarket] = rows;
  expectedPublishedByMarket[otherMarket] = rows.length;
  expectedPublishedHashByMarket[otherMarket] = hashRows(rows);
}

const canonicalTargetPreview = await previewCanonicalPublicCatalogOffers(selectedMarketOffers);
expectedPublishedByMarket[market] = canonicalTargetPreview.offers.length;
expectedPublishedHashByMarket[market] = hashRows(canonicalTargetPreview.offers);

const currentInternal = await readAllOffersForMaintenance();
if (!Array.isArray(currentInternal)) throw new Error("catalog_maintenance_state_invalid");
const preservedInternal = currentInternal.filter((offer) => String(offer?.market || "") !== market);
const invalidInternal = preservedInternal.filter((offer) => {
  const otherMarket = String(offer?.market || "");
  return !offer?.id || !PUBLIC_CATALOG_MARKETS.includes(otherMarket)
    || !isCatalogYearAllowed(offer?.year, otherMarket)
    || !isCatalogMarketSourceAllowed(offer);
});
if (invalidInternal.length) throw new Error(`catalog_preserved_internal_gate_failed:${invalidInternal.length}`);

const unique = new Map();
for (const offer of [...preservedInternal, ...selectedMarketOffers]) {
  if (offer?.id && !unique.has(offer.id)) unique.set(offer.id, offer);
}
// Keep the internal maintenance state a superset of every exact public row,
// including rows restored from an older verified public generation.
for (const rows of Object.values(preservedPublicRowsByMarket)) {
  for (const offer of rows) if (offer?.id && !unique.has(offer.id)) unique.set(offer.id, offer);
}
const allOffers = [...unique.values()];
const previousRetainedCount = currentRetainedRows.length;
const previousPublicCount = currentMarketRows.length;
const minimumSafePublicCount = previousPublicCount >= 100
  ? Math.max(1, Math.ceil(previousPublicCount * minimumPublicRetentionRatio))
  : 1;
const catastrophicPublicCollapse = previousPublicCount >= 100
  && expectedPublishedByMarket[market] < minimumSafePublicCount;
const regressionBlocked = expectedPublishedByMarket[market] <= 0
  || (catastrophicPublicCollapse && !allowPublicCollapse);
let manifest = null;
let publicationError = "";
let nextPublicCount = 0;

if (regressionBlocked) {
  publicationError = `catalog_public_regression_guard:${market}:${expectedPublishedByMarket[market]}:${minimumSafePublicCount}`;
} else if (selectedMarketOffers.length > 0) {
  try {
    process.env.CATALOG_GROW_ONLY_MARKETS = "";
    manifest = await persistCatalogOffers(allOffers, {
      preservePublicOffersByMarket: preservedPublicRowsByMarket,
      beforePersistValidate(publicOffers) {
        const failures = [];
        for (const otherMarket of PUBLIC_CATALOG_MARKETS) {
          if (otherMarket === market) continue;
          const rows = publicOffers.filter((offer) => String(offer?.market || "") === otherMarket);
          const expectedCount = Number(preservedByMarket[otherMarket] || 0);
          const expectedHash = preservedPublicHashByMarket[otherMarket];
          if (rows.length !== expectedCount) failures.push(`${otherMarket}:count:${rows.length}:${expectedCount}`);
          if (hashRows(rows) !== expectedHash) failures.push(`${otherMarket}:hash`);
        }
        if (failures.length) throw new Error(`catalog_prewrite_preservation_gate_failed:${failures.join("|")}`);
      },
      beforePublishValidate(publishedOffers) {
        const failures = [];
        for (const currentMarket of PUBLIC_CATALOG_MARKETS) {
          const rows = publishedOffers.filter((offer) => String(offer?.market || "") === currentMarket);
          if (currentMarket === market) {
            if (rows.length < minimumSafePublicCount) failures.push(`${currentMarket}:count:${rows.length}:${minimumSafePublicCount}`);
            expectedPublishedByMarket[currentMarket] = rows.length;
            expectedPublishedHashByMarket[currentMarket] = hashRows(rows);
            continue;
          }
          const expectedCount = Number(expectedPublishedByMarket[currentMarket] || 0);
          const expectedHash = expectedPublishedHashByMarket[currentMarket];
          if (rows.length !== expectedCount) failures.push(`${currentMarket}:count:${rows.length}:${expectedCount}`);
          if (hashRows(rows) !== expectedHash) failures.push(`${currentMarket}:hash`);
        }
        nextPublicCount = publishedOffers.filter((offer) => String(offer?.market || "") === market).length;
        if (failures.length) throw new Error(`catalog_public_regression_guard:${failures.join("|")}`);
      },
    });
  } catch (error) {
    publicationError = String(error?.message || error);
  }
} else {
  publicationError = `catalog_v2_empty_market:${market}`;
}

const byMarket = Object.fromEntries(PUBLIC_CATALOG_MARKETS.map((marketId) => [
  marketId,
  marketId === market ? (nextPublicCount || selectedMarketOffers.length) : Number(preservedByMarket[marketId] || 0),
]));
const publishedMarketCount = Number(byMarket[market] || 0);
const calculatedCount = canonicalTargetPreview.offers.length;
const preliminaryRejectedCount = canonicalTargetPreview.qualityRejected
  .filter((offer) => String(offer?.calculationStatus || "") === "preliminary_power_pending"
    || offer?.calculationSnapshot?.pricingConfidence === "preliminary")
  .length;
const report = {
  version: 4,
  mode: "catalog_v2_independent_market",
  market,
  publishedAt: new Date().toISOString(),
  published: Boolean(manifest),
  publicationError,
  generationId: manifest?.generationId || null,
  previousManifestPreserved: !manifest,
  retentionMs,
  defaultRetentionMs,
  japanRetentionMs,
  outageGraceMultiplier,
  outageGraceMs: retentionMs * outageGraceMultiplier,
  outageProtectedCount,
  authoritativeExpiredCount,
  outageGraceExpiredCount,
  sourceRefreshStates,
  targetPerSource,
  targetPerMarket,
  maximumPerMarket,
  selectedMarketCount: selectedMarketOffers.length,
  publishedMarketCount,
  addedCount: publishedMarketCount - previousPublicCount,
  shortage: Math.max(0, targetPerMarket - publishedMarketCount),
  total: Object.values(byMarket).reduce((sum, count) => sum + Number(count || 0), 0),
  byMarket,
  byMarketAndSource: {
    [market]: Object.fromEntries([...sourceCounts.entries()].sort(([left], [right]) => left.localeCompare(right))),
  },
  marketQuality: {
    [market]: {
      target: targetPerMarket,
      targetReached: publishedMarketCount >= targetPerMarket,
      shortage: Math.max(0, targetPerMarket - publishedMarketCount),
      generatedCandidates: generation.offers.length,
      retainedCandidates: currentRetainedRows.length,
      previousRetainedCount,
      previousPublicCount,
      nextPublicCount,
      minimumPublicRetentionRatio,
      minimumSafePublicCount,
      catastrophicPublicCollapse,
      regressionBlocked,
      published: publishedMarketCount,
      calculatedCount,
      calculatedShare: selectedMarketOffers.length ? Number((calculatedCount / selectedMarketOffers.length).toFixed(4)) : 0,
      preliminaryRejectedCount,
      priorityCount: v2Selection.priorityCount,
      lowPowerCount: v2Selection.lowPowerCount,
      lowPowerShare: selectedMarketOffers.length ? Number((v2Selection.lowPowerCount / selectedMarketOffers.length).toFixed(4)) : 0,
      auctionCount: v2Selection.auctionCount,
      recentCount: v2Selection.recentCount,
      extendedCount: v2Selection.extendedCount,
      fallbackUnlocked: v2Selection.fallbackUnlocked,
      shortageToUnlock: v2Selection.shortageToUnlock,
      outageProtectedCount,
      authoritativeExpiredCount,
      outageGraceExpiredCount,
      sourceRefreshStates,
      rejectionReasons,
      generationErrors: generation.errors,
      generationStopReasons: generation.payloads.map((payload) => payload.stopReason || payload.report?.stopReason || "unknown"),
    },
  },
  files: generation.filenames,
  preservedByMarket,
  preservedPublicHashByMarket,
  expectedPublishedByMarket,
  expectedPublishedHashByMarket,
};

await fs.writeFile(reportFile, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
} finally {
  await releasePublishLock();
}
