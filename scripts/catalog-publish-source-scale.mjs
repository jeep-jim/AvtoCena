import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const { getJsonStorage, readDataJson, writeDataJson } = await import("../apps/web/lib/data.ts");
const { calculateOfferWithRussiaCustoms } = await import("../apps/web/lib/catalog/customs-pricing.ts");
const { isCrediblePublicOffer } = await import("../apps/web/lib/catalog/offer-quality.ts");
const { compareCatalogPublicPriority } = await import("../apps/web/lib/catalog/public-priority.ts");
const { classifyCatalogV2Offer, selectCatalogV2MarketOffers } = await import("../apps/web/lib/catalog/catalog-v2-policy.ts");
const { normalizeVehicleOfferSpecs } = await import("../apps/web/lib/catalog/spec-normalization.ts");
const {
  CATALOG_CHUNK_SIZE,
  offerPath,
  persistCatalogOffers,
  readAllOffersForMaintenance,
  readMarketOffers,
} = await import("../apps/web/lib/catalog/storage.ts");
const { PUBLIC_CATALOG_MARKETS } = await import("../apps/web/lib/catalog/runtime-config.ts");

const inputDir = process.env.CATALOG_REBUILD_INPUT_DIR || "catalog-rebuild";
const reportFile = process.env.CATALOG_REBUILD_PUBLISH_REPORT || "catalog-source-scale-publish-report.json";
const targetPerSource = Math.max(1, Number(process.env.CATALOG_REBUILD_TARGET_PER_SOURCE || 1_000));
const targetPerMarket = Math.max(1_000, Number(process.env.CATALOG_PUBLISH_TARGET_PER_MARKET || 1_000));
const maximumPerMarket = Math.max(targetPerMarket, Number(process.env.CATALOG_PUBLISH_MAX_PER_MARKET || 30_000));
const minimumImagesPerOffer = Math.max(1, Number(process.env.CATALOG_REBUILD_MIN_IMAGES_PER_OFFER || 1));
const preferredImagesPerOffer = Math.max(minimumImagesPerOffer, Number(process.env.CATALOG_REBUILD_PREFERRED_IMAGES_PER_OFFER || 8));
const retentionMs = Math.max(60_000, Number(process.env.CATALOG_OFFER_RETENTION_MS || 14 * 24 * 60 * 60 * 1_000));
const prepareConcurrency = Math.max(1, Math.min(32, Number(process.env.CATALOG_PUBLISH_PREPARE_CONCURRENCY || 16)));
const priorityMaxTotalRub = Math.max(100_000, Number(process.env.CATALOG_PRIORITY_MAX_TOTAL_RUB || 6_000_000));
const priorityMaxPowerHp = Math.max(1, Number(process.env.CATALOG_PRIORITY_MAX_POWER_HP || 160));
const priorityMaxAgeYears = Math.max(0, Number(process.env.CATALOG_PRIORITY_MAX_AGE_YEARS || 6));
const priorityMinYear = new Date().getFullYear() - priorityMaxAgeYears;
const v2Policy = {
  priorityTarget: Math.max(0, Number(process.env.CATALOG_V2_PRIORITY_TARGET || 1_000)),
  maximumPerMarket,
  priorityMaxAgeYears,
  recentMaxAgeYears: Math.max(priorityMaxAgeYears, Number(process.env.CATALOG_V2_RECENT_MAX_AGE_YEARS || 10)),
  priorityMaxPowerHp,
  priorityMaxTotalRub,
  hardMaxTotalRub: Math.max(priorityMaxTotalRub, Number(process.env.CATALOG_V2_HARD_MAX_TOTAL_RUB || 15_000_000)),
};
const generationKeepCount = Math.max(2, Number(process.env.CATALOG_GENERATION_KEEP_COUNT || 2));
const generationCleanupGraceMs = Math.max(retentionMs, Number(process.env.CATALOG_GENERATION_CLEANUP_GRACE_MS || 4 * 24 * 60 * 60 * 1_000));
const generationHistoryPath = "catalog/generation-history.json";
const configuredMarkets = String(process.env.CATALOG_REBUILD_MARKETS || "").split(",").map((value) => value.trim()).filter(Boolean);
const markets = configuredMarkets.length ? configuredMarkets : [...PUBLIC_CATALOG_MARKETS];
const COMMERCIAL_RE = /\b(?:truck|dump|tipper|bus|minibus|kei\s*truck|commercial|cargo|lorry|tractor|forklift|excavator|machinery|canter|fighter|ranger|dutro|forward|giga|elf|profia|8\s*tonne|8\s*ton)\b|(?:货车|卡车|客车|巴士|工程机械|商用车)/i;

function imageKey(image) {
  return String(image?.checksum || image?.id || image?.objectKey || image?.url || "");
}

function freshness(offer) {
  return Date.parse(String(offer?.operational?.sourcePublishedAt || offer?.updatedAt || offer?.firstSeenAt || "")) || 0;
}

function qualityOrder(left, right) {
  return compareCatalogPublicPriority(left, right)
    || freshness(right) - freshness(left)
    || String(left?.id || "").localeCompare(String(right?.id || ""));
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

function overlayDefined(base, overlay) {
  const result = { ...(base || {}) };
  for (const [key, value] of Object.entries(overlay || {})) {
    if (value === undefined || value === null || value === "") continue;
    result[key] = value;
  }
  return result;
}

function earliestIso(...values) {
  const valid = values.map((value) => ({ value, time: Date.parse(String(value || "")) })).filter((entry) => Number.isFinite(entry.time));
  return valid.sort((left, right) => left.time - right.time)[0]?.value;
}

function latestIso(...values) {
  const valid = values.map((value) => ({ value, time: Date.parse(String(value || "")) })).filter((entry) => Number.isFinite(entry.time));
  return valid.sort((left, right) => right.time - left.time)[0]?.value;
}

function mergeOfferVersions(primary, retained) {
  if (!retained) return { ...primary, images: uniqueImages(primary?.images) };
  const merged = overlayDefined(retained, primary);
  const primaryRaw = typeof primary?.operational?.raw === "object" && primary.operational.raw ? primary.operational.raw : {};
  const retainedRaw = typeof retained?.operational?.raw === "object" && retained.operational.raw ? retained.operational.raw : {};
  return {
    ...merged,
    firstSeenAt: earliestIso(primary?.firstSeenAt, retained?.firstSeenAt) || primary?.firstSeenAt || retained?.firstSeenAt,
    updatedAt: latestIso(primary?.updatedAt, retained?.updatedAt) || primary?.updatedAt || retained?.updatedAt,
    images: uniqueImages([...(primary?.images || []), ...(retained?.images || [])]),
    calculationSnapshot: overlayDefined(retained?.calculationSnapshot, primary?.calculationSnapshot),
    operational: {
      ...overlayDefined(retained?.operational, primary?.operational),
      raw: overlayDefined(retainedRaw, primaryRaw),
    },
  };
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

function isCommercial(offer) {
  return COMMERCIAL_RE.test(`${offer?.make || ""} ${offer?.model || ""} ${offer?.trim || ""} ${offer?.bodyType || ""}`)
    || /^(?:Hino|Mitsubishi Fuso)$/i.test(String(offer?.make || ""));
}

function cleanShard(value) {
  const normalized = String(value || "unknown").toLowerCase().replace(/[^a-z0-9а-яё-]+/gi, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "unknown";
  if (Buffer.byteLength(normalized, "utf8") <= 180) return normalized;
  const digest = crypto.createHash("sha256").update(normalized).digest("hex").slice(0, 16);
  let prefix = "";
  for (const character of normalized) {
    if (Buffer.byteLength(`${prefix}${character}`, "utf8") > 150) break;
    prefix += character;
  }
  return `${prefix.replace(/-+$/g, "") || "value"}-${digest}`;
}

function budgetBucket(value) {
  const number = Number(value || 0);
  return number > 0 ? String(Math.ceil(number / 500_000) * 500_000) : "unknown";
}

function generationInventory(manifest, offers) {
  if (!manifest?.generationId) return [];
  const generationId = manifest.generationId;
  const keys = new Set([
    `catalog/generations/${generationId}/indexes/offers-by-id.json`,
    `catalog/generations/${generationId}/indexes/images-by-id.json`,
    `catalog/generations/${generationId}/indexes/facets.json`,
    `catalog/generations/${generationId}/indexes/order-updatedAt.json`,
    `catalog/generations/${generationId}/inventory.json`,
  ]);
  for (const [market, descriptor] of Object.entries(manifest.markets || {})) {
    for (const chunk of descriptor?.chunks || []) keys.add(offerPath(generationId, market, chunk));
  }
  const maps = {
    market: new Set(), make: new Set(), model: new Set(), year: new Set(), budget: new Set(),
    fuel: new Set(), body: new Set(), transmission: new Set(), drive: new Set(), hasPrice: new Set(),
  };
  const sourceCounts = new Map();
  for (const offer of offers) {
    const make = String(offer?.make || "").trim();
    const model = String(offer?.model || "").trim();
    const pairs = {
      market: offer?.market,
      make,
      model: `${make}:${model}`,
      year: offer?.year,
      budget: budgetBucket(offer?.totalRub),
      fuel: offer?.fuel,
      body: offer?.bodyType,
      transmission: offer?.transmission,
      drive: offer?.drive,
      hasPrice: offer?.totalRub ? "yes" : "no",
    };
    for (const [name, value] of Object.entries(pairs)) maps[name].add(cleanShard(value));
    const sourceId = String(offer?.sourceId || "unknown");
    sourceCounts.set(sourceId, Number(sourceCounts.get(sourceId) || 0) + 1);
  }
  for (const [name, values] of Object.entries(maps)) {
    for (const value of values) keys.add(`catalog/generations/${generationId}/indexes/${name}/${value}.json`);
  }
  for (const [sourceId, count] of sourceCounts) {
    const chunkCount = Math.ceil(count / CATALOG_CHUNK_SIZE);
    for (let index = 1; index <= chunkCount; index++) {
      keys.add(`catalog/internal/offers/${sourceId}/${generationId}-chunk-${String(index).padStart(4, "0")}.json`);
    }
  }
  return [...keys].sort();
}

async function recordAndCleanupGenerations(manifest, offers, publishedAt) {
  if (!manifest?.generationId) return { recorded: false, deletedGenerations: [], deletedObjects: 0, errors: [] };
  const storage = getJsonStorage();
  const objectKeys = generationInventory(manifest, offers);
  const inventoryPath = `catalog/generations/${manifest.generationId}/inventory.json`;
  await writeDataJson(inventoryPath, { version: 1, generationId: manifest.generationId, publishedAt, objectKeys });
  const current = await readDataJson(generationHistoryPath, { version: 1, generations: [] });
  const previousEntries = Array.isArray(current?.generations) ? current.generations : [];
  const nextEntry = { generationId: manifest.generationId, publishedAt, inventoryPath, objectKeys };
  const generations = [nextEntry, ...previousEntries.filter((entry) => entry?.generationId && entry.generationId !== manifest.generationId)]
    .slice(0, 60);
  const protectedIds = new Set(generations.slice(0, generationKeepCount).map((entry) => entry.generationId));
  const cutoff = Date.now() - generationCleanupGraceMs;
  const deletedGenerations = [];
  const errors = [];
  let deletedObjects = 0;
  const retained = [];

  for (const entry of generations) {
    const published = Date.parse(String(entry?.publishedAt || ""));
    const eligible = entry?.generationId !== manifest.generationId
      && !protectedIds.has(entry?.generationId)
      && Number.isFinite(published)
      && published < cutoff
      && Array.isArray(entry?.objectKeys)
      && entry.objectKeys.length > 0;
    if (!eligible) {
      retained.push(entry);
      continue;
    }
    let failed = false;
    for (const key of entry.objectKeys) {
      try {
        await storage.deleteJson?.(String(key));
        deletedObjects++;
      } catch (error) {
        failed = true;
        if (errors.length < 200) errors.push({ generationId: entry.generationId, key, error: String(error?.message || error) });
      }
    }
    if (failed) retained.push(entry);
    else deletedGenerations.push(entry.generationId);
  }

  await writeDataJson(generationHistoryPath, {
    version: 1,
    updatedAt: new Date().toISOString(),
    keepCount: generationKeepCount,
    cleanupGraceMs: generationCleanupGraceMs,
    generations: retained,
  });
  return { recorded: true, inventoryObjects: objectKeys.length, deletedGenerations, deletedObjects, errors };
}

async function generationFilesForMarket(market) {
  let names = [];
  try { names = await fs.readdir(inputDir); } catch { return []; }
  return names
    .filter((name) => name === `catalog-rebuild-${market}.json` || (name.startsWith(`catalog-rebuild-${market}-`) && name.endsWith(".json")))
    .map((name) => path.join(inputDir, name))
    .sort();
}

async function readGenerationFiles(market) {
  const filenames = await generationFilesForMarket(market);
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
  return { available: payloads.length > 0, filenames, payloads, offers, errors };
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

async function auditCandidate(sourceOffer, market) {
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

let internalRows = [];
try { internalRows = await readAllOffersForMaintenance(); } catch { internalRows = []; }
const cutoff = Date.now() - retentionMs;
const allSelected = [];
const files = [];
const byMarket = {};
const byMarketAndSource = {};
const marketQuality = {};
const marketReports = {};

for (const market of markets) {
  const generation = await readGenerationFiles(market);
  let publicRows = [];
  try { publicRows = await readMarketOffers(market); } catch { publicRows = []; }

  const retainedById = new Map();
  for (const offer of [...publicRows, ...internalRows]
    .filter((row) => row?.market === market && ["active", "stale"].includes(String(row?.status || "")) && freshness(row) >= cutoff)
    .sort((left, right) => freshness(left) - freshness(right))) {
    retainedById.set(offer.id, mergeOfferVersions(offer, retainedById.get(offer.id)));
  }

  const generatedById = new Map();
  const generatedOrigins = new Map();
  let galleriesAccumulated = 0;
  const generationRows = [...generation.offers].sort((left, right) => {
    const leftFresh = String(left?.operational?.galleryRebuiltFrom || "") === "fresh_listing" ? 1 : 0;
    const rightFresh = String(right?.operational?.galleryRebuiltFrom || "") === "fresh_listing" ? 1 : 0;
    return leftFresh - rightFresh || freshness(left) - freshness(right);
  });
  for (const offer of generationRows) {
    if (!offer?.id) continue;
    const existing = generatedById.get(offer.id) || retainedById.get(offer.id);
    const before = Number(offer?.images?.length || 0);
    const merged = mergeOfferVersions(offer, existing);
    if (merged.images.length > before) galleriesAccumulated++;
    generatedById.set(offer.id, merged);
    if (String(offer?.operational?.galleryRebuiltFrom || "") === "fresh_listing") generatedOrigins.set(offer.id, "fresh");
    else if (!generatedOrigins.has(offer.id)) generatedOrigins.set(offer.id, "rebuilt");
  }

  const freshRows = [...generatedById.values()].filter((offer) => generatedOrigins.get(offer.id) === "fresh").sort(qualityOrder);
  const rebuiltRows = [...generatedById.values()].filter((offer) => generatedOrigins.get(offer.id) !== "fresh").sort(qualityOrder);
  const retainedRows = [...retainedById.values()].filter((offer) => !generatedById.has(offer.id)).sort(qualityOrder);
  const origins = [["fresh", freshRows], ["rebuilt", rebuiltRows], ["retained", retainedRows]];
  const selected = [];
  const selectedIds = new Set();
  const imageOwners = new Map();
  const sourceCounts = new Map();
  const rejectionReasons = {};
  const originCounts = { fresh: 0, rebuilt: 0, retained: 0 };

  for (const [origin, rows] of origins) {
    const uniqueRows = [];
    const queued = new Set();
    for (const row of rows) {
      if (!row?.id || selectedIds.has(row.id) || queued.has(row.id)) continue;
      queued.add(row.id);
      uniqueRows.push(row);
    }
    for (let start = 0; start < uniqueRows.length && selected.length < maximumPerMarket; start += prepareConcurrency) {
      const batch = uniqueRows.slice(start, start + prepareConcurrency);
      const audited = await runWithConcurrency(batch, prepareConcurrency, (row) => auditCandidate(row, market));
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
        originCounts[origin]++;
        if (selected.length >= maximumPerMarket) break;
      }
    }
  }

  selected.sort(qualityOrder);
  const v2Selection = selectCatalogV2MarketOffers(selected, v2Policy);
  selected.splice(0, selected.length, ...v2Selection.selected);
  sourceCounts.clear();
  for (const offer of selected) {
    const sourceId = String(offer.sourceId || "unknown");
    sourceCounts.set(sourceId, Number(sourceCounts.get(sourceId) || 0) + 1);
  }
  files.push(...generation.filenames);
  allSelected.push(...selected);
  byMarket[market] = selected.length;
  byMarketAndSource[market] = Object.fromEntries([...sourceCounts.entries()].sort(([left], [right]) => left.localeCompare(right)));
  marketReports[market] = generation.payloads.map((payload) => payload.report || payload);
  const imageCounts = selected.map((offer) => offer.images.length);
  const calculatedCount = selected.filter((offer) => Number(offer.totalRub || 0) > 0).length;
  const priorityCount = v2Selection.priorityCount;
  marketQuality[market] = {
    target: targetPerMarket,
    targetReached: selected.length >= targetPerMarket,
    shortage: Math.max(0, targetPerMarket - selected.length),
    generationAvailable: generation.available,
    generationFiles: generation.filenames,
    generationErrors: generation.errors,
    generationPartial: generation.payloads.some((payload) => Boolean(payload.partial || payload.report?.partial)),
    generationStopReasons: generation.payloads.map((payload) => payload.stopReason || payload.report?.stopReason || "unknown"),
    freshCandidates: freshRows.length,
    rebuiltCandidates: rebuiltRows.length,
    retainedCandidates: retainedRows.length,
    galleriesAccumulated,
    published: selected.length,
    calculatedCount,
    calculatedShare: selected.length ? Number((calculatedCount / selected.length).toFixed(4)) : 0,
    priorityCount,
    auctionCount: v2Selection.auctionCount,
    recentCount: v2Selection.recentCount,
    extendedCount: v2Selection.extendedCount,
    fallbackUnlocked: v2Selection.fallbackUnlocked,
    shortageToUnlock: v2Selection.shortageToUnlock,
    v2Rejected: v2Selection.rejected,
    priorityMaxTotalRub,
    priorityMaxPowerHp,
    priorityMinYear,
    byOrigin: originCounts,
    publishedSources: sourceCounts.size,
    bySource: byMarketAndSource[market],
    rejectionReasons,
    minimumImages: imageCounts.length ? Math.min(...imageCounts) : 0,
    maximumImages: imageCounts.length ? Math.max(...imageCounts) : 0,
    averageImages: imageCounts.length ? Number((imageCounts.reduce((sum, count) => sum + count, 0) / imageCounts.length).toFixed(2)) : 0,
    preferredImagesShare: imageCounts.length ? Number((imageCounts.filter((count) => count >= preferredImagesPerOffer).length / imageCounts.length).toFixed(4)) : 0,
    retainedPreviousMarket: originCounts.retained > 0,
    temporarilyUnavailable: selected.length === 0,
  };
}

const unique = new Map();
for (const offer of allSelected) if (!unique.has(offer.id)) unique.set(offer.id, offer);
const offers = [...unique.values()];
const publishedAt = new Date().toISOString();
const emptyMarkets = markets.filter((market) => Number(byMarket[market] || 0) === 0);
let manifest = null;
let publicationError = "";
let generationCleanup = { recorded: false, deletedGenerations: [], deletedObjects: 0, errors: [] };

if (offers.length && emptyMarkets.length === 0) {
  try {
    process.env.CATALOG_GROW_ONLY_MARKETS = emptyMarkets.join(",");
    manifest = await persistCatalogOffers(offers);
    generationCleanup = await recordAndCleanupGenerations(manifest, offers, publishedAt);
  } catch (error) {
    publicationError = String(error?.message || error);
  }
} else {
  publicationError = emptyMarkets.length ? `catalog_v2_empty_markets:${emptyMarkets.join(",")}` : "no_verified_offers_keep_previous_manifest";
}

const marketsBelowTarget = markets.filter((market) => Number(byMarket[market] || 0) < targetPerMarket);
const report = {
  version: 38,
  mode: "catalog_v2_tiered_atomic_all_markets",
  publishedAt,
  published: Boolean(manifest),
  publicationError,
  generationId: manifest?.generationId || null,
  previousManifestPreserved: !manifest,
  retentionMs,
  targetPerSource,
  targetPerMarket,
  maximumPerMarket,
  priorityMaxTotalRub,
  priorityMaxPowerHp,
  priorityMinYear,
  v2Policy,
  total: offers.length,
  byMarket,
  byMarketAndSource,
  volumeTargetReached: marketsBelowTarget.length === 0,
  marketsBelowTarget,
  emptyMarketsPreserved: emptyMarkets,
  files,
  missingGenerationMarkets: markets.filter((market) => !marketQuality[market]?.generationAvailable),
  partialGenerationMarkets: markets.filter((market) => marketQuality[market]?.generationPartial),
  marketQuality,
  marketReports,
  generationCleanup,
};

await fs.writeFile(reportFile, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
