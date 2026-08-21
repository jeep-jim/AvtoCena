import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const { persistCatalogOffers, previewCanonicalPublicCatalogOffers, readMarketOffers, readAllOffersForMaintenance } = await import("../apps/web/lib/catalog/storage.ts");
const { credibleCatalogImages, isCatalogOfferBusinessLiquid, hasCredibleOfferContent, catalogMinYearForMarket, isCatalogYearAllowed, isCatalogMarketSourceAllowed } = await import("../apps/web/lib/catalog/offer-quality.ts");
const { normalizeVehicleOfferSpecs } = await import("../apps/web/lib/catalog/spec-normalization.ts");
const { calculateOfferWithPreliminaryPowerPricing, calculateOfferWithRussiaCustoms, isPreliminaryPowerPendingCalculation } = await import("../apps/web/lib/catalog/customs-pricing.ts");
const { refreshLiveExchangeRates } = await import("../apps/web/lib/catalog/live-rates.ts");
const { resetCatalogRateCache } = await import("../apps/web/lib/catalog/rates.ts");
const { PUBLIC_CATALOG_MARKETS, CATALOG_RETENTION_MS, CATALOG_MAX_PUBLIC_OFFERS_PER_MARKET } = await import("../apps/web/lib/catalog/runtime-config.ts");
const { CATALOG_MAX_OFFERS_PER_MODEL_YEAR, catalogModelYearQuotaKey, catalogExactModelKey } = await import("../apps/web/lib/catalog/inventory-quota.ts");

const markets = String(process.env.RECOVERY_BATCH_MARKETS || "uae,georgia")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const inputDir = String(process.env.RECOVERY_BATCH_INPUT_DIR || "recovery-input").trim();
const output = String(process.env.RECOVERY_BATCH_REPORT || "catalog-direct-recovery-batch-publish-report.json").trim();
const dryRun = /^(1|true|yes)$/i.test(String(process.env.RECOVERY_BATCH_DRY_RUN || ""));
const preserveUntouchedExact = true; // mandatory fail-closed full-state preservation
const maxPerMarket = Math.max(1, Math.min(CATALOG_MAX_PUBLIC_OFFERS_PER_MARKET || 100_000, Number(process.env.RECOVERY_PUBLISH_MAX || CATALOG_MAX_PUBLIC_OFFERS_PER_MARKET || 100_000)));
const preferredMaxRub = Math.max(500_000, Number(process.env.RECOVERY_PREFERRED_MAX_RUB || 8_000_000));
const maxOffersPerModelYear = CATALOG_MAX_OFFERS_PER_MODEL_YEAR;
const minImagesPerOffer = Math.max(1, Math.min(30, Number(process.env.CATALOG_REBUILD_MIN_IMAGES_PER_OFFER || 5)));
const retentionMs = Math.max(60 * 60 * 1_000, Number(process.env.CATALOG_OFFER_RETENTION_MS || CATALOG_RETENTION_MS || 259_200_000));
const retentionCutoff = Date.now() - retentionMs;

if (!markets.length || markets.some((market) => !PUBLIC_CATALOG_MARKETS.includes(market))) {
  throw new Error(`recovery_batch_markets_invalid:${markets.join(",")}`);
}

const refreshedRates = await refreshLiveExchangeRates();
resetCatalogRateCache();
const currentRates = new Map((Array.isArray(refreshedRates?.rates) ? refreshedRates.rates : [])
  .filter((rate) => String(rate?.rateSource || "") === "cbr")
  .map((rate) => [String(rate.currency || "").toUpperCase(), rate]));
let rateRepriced = 0;
let rateRepriceFailed = 0;

function materiallyDifferentRate(stored, current) {
  const left = Number(stored?.effectiveRate || 0);
  const right = Number(current?.effectiveRate || 0);
  return right > 0 && (!(left > 0) || Math.abs(left - right) / right > 0.000001);
}

function needsCurrentRateReprice(offer) {
  if (String(offer?.market || "") === "japan") return false;
  const sourceRate = currentRates.get(String(offer?.sourceCurrency || "").toUpperCase());
  const eurRate = currentRates.get("EUR");
  if (!sourceRate || !eurRate) return false;
  return materiallyDifferentRate(offer?.calculationSnapshot?.currencyRate, sourceRate)
    || materiallyDifferentRate(offer?.calculationSnapshot?.eurRate, eurRate);
}

async function repriceWithCurrentRates(offer) {
  if (String(offer?.market || "") === "japan") return { ...offer, previousTotalRub: null, priceDeltaRub: null, priceChangedAt: undefined };
  if (!needsCurrentRateReprice(offer)) return offer;
  try {
    const calculated = isPreliminaryPowerPendingCalculation(offer)
      ? await calculateOfferWithPreliminaryPowerPricing(offer)
      : await calculateOfferWithRussiaCustoms(offer);
    rateRepriced++;
    return calculated;
  } catch (error) {
    rateRepriceFailed++;
    console.warn(`[current-rate] ${offer?.market || "unknown"}/${offer?.id || "unknown"}: ${String(error?.message || error)}`);
    return offer;
  }
}

async function repriceRowsWithCurrentRates(rows) {
  const input = rows.map(normalizeVisible);
  const output = new Array(input.length);
  let cursor = 0;
  const concurrency = Math.max(1, Math.min(24, Number(process.env.RECOVERY_REPRICE_CONCURRENCY || 12)));
  await Promise.all(Array.from({ length: Math.min(concurrency, input.length || 1) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= input.length) return;
      output[index] = await repriceWithCurrentRates(input[index]);
    }
  }));
  return output;
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
  const motor30 = Number(offer?.power30MinKw || 0) || (Array.isArray(offer?.power30MinKwByMotor)
    ? offer.power30MinKwByMotor.reduce((sum, value) => sum + Math.max(0, Number(value || 0)), 0)
    : 0);
  return kind === "other_hybrid" ? motor30 > 0 && Number(offer?.icePowerKw || 0) > 0 : motor30 > 0;
}
function publishableCalculation(offer) {
  return exactCalculation(offer) || isPreliminaryPowerPendingCalculation(offer);
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
function canonicalPublic(offer) {
  return hasCredibleOfferContent({ ...offer, status: "active" });
}
function publicExistingStillValid(offer) {
  return canonicalPublic(offer) && publishableCalculation(offer) && isCatalogOfferBusinessLiquid(offer);
}
function freshness(offer) {
  return Date.parse(String(offer?.auctionDate || offer?.operational?.sourcePublishedAt || offer?.updatedAt || offer?.firstSeenAt || "")) || 0;
}
function withinRetention(offer) {
  const timestamp = freshness(offer);
  return timestamp > 0 && timestamp >= retentionCutoff;
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

function makeKey(offer) {
  return String(offer?.make || "").trim().toLocaleLowerCase("en-US").replace(/\s+/g, " ");
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
function applyPerModelYearCap(rows, rejected) {
  const selected = [];
  const countByModelYear = new Map();
  for (const offer of rows) {
    const model = catalogModelYearQuotaKey(offer, offer?.market);
    if (!model) continue;
    if (Number(countByModelYear.get(model) || 0) >= maxOffersPerModelYear) {
      rejected.model_year_quota = Number(rejected.model_year_quota || 0) + 1;
      continue;
    }
    countByModelYear.set(model, Number(countByModelYear.get(model) || 0) + 1);
    selected.push(offer);
    if (selected.length >= maxPerMarket) break;
  }
  return { selected, countByModelYear };
}

const selectedByMarket = new Map();
const incomingIdsByMarket = new Map();
const rejectedByMarket = {};
const previousPublicCountByMarket = {};
const retainedPreviousByMarket = new Map();
for (const market of markets) {
  const input = path.join(inputDir, `catalog-rebuild-${market}.json`);
  const payload = JSON.parse(await fs.readFile(input, "utf8"));
  const sourceRows = Array.isArray(payload?.offers) ? payload.offers : [];
  const incoming = new Map();
  const rejected = {};
  const reject = (reason) => { rejected[reason] = Number(rejected[reason] || 0) + 1; };
  for (const offer of await repriceRowsWithCurrentRates(sourceRows)) {
    if (!offer?.id || incoming.has(offer.id)) continue;
    if (offer.market !== market) { reject("market"); continue; }
    const year = Number(offer.year || 0);
    if (!isCatalogYearAllowed(year, market)) { reject("year"); continue; }
    if (!isCatalogOfferBusinessLiquid(offer)) { reject("business_liquidity"); continue; }
    if (!offer.make || !offer.model) { reject("visible_core"); continue; }
    if (offer.images.length < minImagesPerOffer) { reject("images"); continue; }
    if (!exactSourceBound(offer)) { reject("source_binding"); continue; }
    if (!publishableCalculation(offer)) { reject("calculation"); continue; }
    if (!canonicalPublic(offer)) { reject("public_quality"); continue; }
    incoming.set(offer.id, offer);
  }

  let previous = [];
  try { previous = await readMarketOffers(market); } catch { previous = []; }
  previousPublicCountByMarket[market] = previous.length;
  const candidates = new Map();
  const retainedPrevious = [];
  for (const offer of await repriceRowsWithCurrentRates(previous)) {
    const year = Number(offer?.year || 0);
    if (!offer?.id || !["active", "stale"].includes(String(offer?.status || ""))) continue;
    if (!isCatalogYearAllowed(year, market) || !offer.make || !offer.model || offer.images.length < minImagesPerOffer) continue;
    if (!withinRetention(offer) || !publicExistingStillValid(offer)) continue;
    candidates.set(offer.id, offer);
    retainedPrevious.push(offer);
  }
  for (const [id, offer] of incoming) candidates.set(id, offer);

  const cumulative = [...candidates.values()].sort(quality);
  const capped = applyPerModelYearCap(cumulative, rejected);
  const marketRows = capped.selected;
  if (!marketRows.length) throw new Error(`recovery_batch_empty_market:${market}`);
  if (marketRows.some((offer) => offer.images.length < minImagesPerOffer)) {
    throw new Error(`recovery_batch_target_image_gate_failed:${market}:${minImagesPerOffer}`);
  }
  selectedByMarket.set(market, marketRows);
  retainedPreviousByMarket.set(market, retainedPrevious);
  incomingIdsByMarket.set(market, new Set(incoming.keys()));
  rejectedByMarket[market] = rejected;
}

const combined = [];
for (const marketRows of selectedByMarket.values()) combined.push(...marketRows);
const preservedByMarket = {};
const preservedInternalByMarket = {};
const preservedPublicHashByMarket = {};
const expectedPublishedByMarket = {};
const expectedPublishedHashByMarket = {};
const preservedPublicRowsByMarket = {};
const maintenanceOffers = preserveUntouchedExact ? await readAllOffersForMaintenance() : [];
if (preserveUntouchedExact && !Array.isArray(maintenanceOffers)) throw new Error("recovery_batch_maintenance_state_invalid");
for (const other of PUBLIC_CATALOG_MARKETS) {
  if (markets.includes(other)) continue;
  let rows = [];
  try { rows = await readMarketOffers(other); } catch { rows = []; }
  if (preserveUntouchedExact) {
    const invalidPublic = rows.filter((offer) => !offer?.id || !offer?.make || !offer?.model || !isCatalogYearAllowed(offer?.year, other) || !isCatalogMarketSourceAllowed(offer) || !Array.isArray(offer?.images) || offer.images.length === 0);
    if (invalidPublic.length) throw new Error(`recovery_batch_preserved_public_gate_failed:${other}:${invalidPublic.length}`);
    const internalRows = maintenanceOffers.filter((offer) => String(offer?.market || "") === other);
    if (rows.length > 0 && internalRows.length === 0) throw new Error(`recovery_batch_preserved_internal_missing:${other}`);
    const invalidInternal = internalRows.filter((offer) => !offer?.id || !isCatalogYearAllowed(offer?.year, other) || !isCatalogMarketSourceAllowed(offer));
    if (invalidInternal.length) throw new Error(`recovery_batch_preserved_internal_gate_failed:${other}:${invalidInternal.length}`);
    preservedByMarket[other] = rows.length;
    preservedInternalByMarket[other] = internalRows.length;
    preservedPublicHashByMarket[other] = hashRows(rows);
    preservedPublicRowsByMarket[other] = rows;
    const canonical = await previewCanonicalPublicCatalogOffers(rows);
    expectedPublishedByMarket[other] = canonical.offers.length;
    expectedPublishedHashByMarket[other] = hashRows(canonical.offers);
    combined.push(...internalRows);
    continue;
  }
  const preserved = rows
    .filter((offer) => ["active", "stale"].includes(String(offer?.status || "")))
    .map((offer) => normalizeVisible(offer))
    .filter((offer) => offer.id && offer.make && offer.model && isCatalogYearAllowed(offer.year, other) && offer.images.length > 0 && withinRetention(offer) && canonicalPublic(offer) && isCatalogOfferBusinessLiquid(offer))
    .slice(0, CATALOG_MAX_PUBLIC_OFFERS_PER_MARKET || 100_000);
  preservedByMarket[other] = preserved.length;
  combined.push(...preserved);
}

for (const targetMarket of markets) {
  const canonical = await previewCanonicalPublicCatalogOffers(selectedByMarket.get(targetMarket) || []);
  expectedPublishedByMarket[targetMarket] = canonical.offers.length;
  expectedPublishedHashByMarket[targetMarket] = hashRows(canonical.offers);
}

const marketReports = {};
for (const market of markets) {
  const rows = selectedByMarket.get(market) || [];
  const incomingIds = incomingIdsByMarket.get(market) || new Set();
  marketReports[market] = {
    count: rows.length,
    previousCount: Number(previousPublicCountByMarket[market] || 0),
    previousRetainedCount: (retainedPreviousByMarket.get(market) || []).length,
    incomingCount: rows.filter((offer) => incomingIds.has(offer.id)).length,
    retainedCount: rows.filter((offer) => !incomingIds.has(offer.id)).length,
    preferredCount: rows.filter((offer) => Number(offer.totalRub || 0) <= preferredMaxRub).length,
    calculatedCount: rows.filter(exactCalculation).length,
    preliminaryCount: rows.filter(isPreliminaryPowerPendingCalculation).length,
    minYear: catalogMinYearForMarket(market),
    retentionMs,
    rateRepriced,
    rateRepriceFailed,
    officialRateDate: String(currentRates.get("EUR")?.rateDate || ""),
    preferredMaxRub,
    maxOffersPerModelYear,
    minImagesPerOffer,
    distinctModels: new Set(rows.map((offer) => catalogExactModelKey(offer, market)).filter(Boolean)).size,
    distinctModelYears: new Set(rows.map((offer) => catalogModelYearQuotaKey(offer, market)).filter(Boolean)).size,
    distinctMakes: new Set(rows.map(makeKey)).size,
    sourceCounts: Object.fromEntries([...new Set(rows.map((offer) => String(offer.sourceId || "unknown")))].map((sourceId) => [sourceId, rows.filter((offer) => String(offer.sourceId || "unknown") === sourceId).length])),
    imageStats: {
      min: Math.min(...rows.map((offer) => offer.images.length)),
      max: Math.max(...rows.map((offer) => offer.images.length)),
      average: Number((rows.reduce((sum, offer) => sum + offer.images.length, 0) / rows.length).toFixed(2)),
      belowMinimum: rows.filter((offer) => offer.images.length < minImagesPerOffer).length,
    },
    rejected: rejectedByMarket[market],
  };
}

if (dryRun) {
  const report = {
    version: 5,
    mode: "live_markets_publishable_cumulative_batch_dry_run",
    markets,
    dryRun: true,
    published: false,
    retentionMs,
    minImagesPerOffer,
    preserveUntouchedExact,
    byMarket: marketReports,
    preservedByMarket,
    preservedInternalByMarket,
    preservedPublicHashByMarket,
    expectedPublishedByMarket,
    expectedPublishedHashByMarket,
  };
  await fs.writeFile(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

const unique = new Map();
for (const offer of combined) if (offer?.id && !unique.has(offer.id)) unique.set(offer.id, offer);
if (preserveUntouchedExact && unique.size !== combined.length) throw new Error(`recovery_batch_duplicate_id_in_full_state:${combined.length - unique.size}`);
process.env.CATALOG_GROW_ONLY_MARKETS = "";
const manifest = await persistCatalogOffers([...unique.values()], {
  preservePublicOffersByMarket: preserveUntouchedExact ? preservedPublicRowsByMarket : undefined,
  beforePersistValidate(publicOffers) {
    const failures = [];
    for (const other of PUBLIC_CATALOG_MARKETS) {
      if (markets.includes(other)) continue;
      const projectedRows = publicOffers.filter((offer) => String(offer?.market || "") === other);
      const expectedCount = Number(preservedByMarket[other] || 0);
      const projectedHash = hashRows(projectedRows);
      if (projectedRows.length !== expectedCount) failures.push(`${other}:count:${projectedRows.length}:${expectedCount}`);
      if (projectedHash !== preservedPublicHashByMarket[other]) failures.push(`${other}:hash:${projectedHash}:${preservedPublicHashByMarket[other]}`);
    }
    if (failures.length) throw new Error(`recovery_batch_prewrite_preservation_gate_failed:${failures.join("|")}`);
  },
  beforePublishValidate(publishedOffers) {
    const failures = [];
    for (const other of PUBLIC_CATALOG_MARKETS) {
      const rows = publishedOffers.filter((offer) => String(offer?.market || "") === other);
      const expectedCount = Number(expectedPublishedByMarket[other] || 0);
      const expectedHash = expectedPublishedHashByMarket[other];
      if (rows.length !== expectedCount) failures.push(`${other}:count:${rows.length}:${expectedCount}`);
      if (hashRows(rows) !== expectedHash) failures.push(`${other}:hash`);
    }
    if (failures.length) throw new Error(`recovery_batch_public_regression_guard:${failures.join("|")}`);
  },
});

for (const market of markets) {
  const manifestCount = Number(manifest?.markets?.[market]?.count || 0);
  marketReports[market].selectedCandidateCount = marketReports[market].count;
  marketReports[market].count = manifestCount;
  marketReports[market].addedCount = manifestCount - Number(previousPublicCountByMarket[market] || 0);
}

if (preserveUntouchedExact) {
  for (const other of PUBLIC_CATALOG_MARKETS) {
    if (markets.includes(other)) continue;
    const manifestCount = Number(manifest?.markets?.[other]?.count || 0);
    if (manifestCount !== Number(expectedPublishedByMarket[other] || 0)) throw new Error(`recovery_batch_preserved_manifest_mismatch:${other}:${manifestCount}:${expectedPublishedByMarket[other] || 0}`);
    const afterRows = await readMarketOffers(other);
    if (afterRows.length !== Number(expectedPublishedByMarket[other] || 0)) throw new Error(`recovery_batch_preserved_count_mismatch:${other}:${afterRows.length}:${expectedPublishedByMarket[other] || 0}`);
    const afterHash = hashRows(afterRows);
    if (afterHash !== expectedPublishedHashByMarket[other]) throw new Error(`recovery_batch_preserved_hash_mismatch:${other}:${afterHash}:${expectedPublishedHashByMarket[other]}`);
  }
}

const report = {
  version: 5,
  mode: "live_markets_publishable_cumulative_batch_publish",
  markets,
  publishedAt: new Date().toISOString(),
  published: true,
  generationId: manifest.generationId,
  retentionMs,
  rateRepriced,
  rateRepriceFailed,
  officialRateDate: String(currentRates.get("EUR")?.rateDate || ""),
  minImagesPerOffer,
  preserveUntouchedExact,
  byMarket: marketReports,
  preservedByMarket,
  preservedInternalByMarket,
  preservedPublicHashByMarket,
  expectedPublishedByMarket,
  expectedPublishedHashByMarket,
  previousPublicCountByMarket,
  manifestCounts: Object.fromEntries(PUBLIC_CATALOG_MARKETS.map((market) => [market, Number(manifest?.markets?.[market]?.count || 0)])),
};
await fs.writeFile(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
