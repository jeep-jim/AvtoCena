import fs from "node:fs/promises";
import path from "node:path";

const { catalogRequiredSpecificationRejectionReason } = await import("../apps/web/lib/catalog/public-priority.ts");

const inputDir = process.env.CATALOG_REBUILD_INPUT_DIR || "catalog-rebuild";
const markets = String(process.env.CATALOG_REBUILD_MARKETS || "korea,china,japan,uae,europe,georgia,kyrgyzstan")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const outputFile = process.env.CATALOG_REBUILD_VALIDATION_REPORT || "catalog-source-scale-validation-report.json";
const configuredMinimumProductiveSources = Number(process.env.CATALOG_PUBLISH_MIN_PRODUCTIVE_SOURCES || 0);
const targetPerMarket = Math.max(1_000, Number(process.env.CATALOG_PUBLISH_TARGET_PER_MARKET || 1_000));

const defaultMinimumProductiveSources = {
  korea: 2,
  china: 2,
  japan: 2,
  uae: 2,
  europe: 2,
  georgia: 2,
  kyrgyzstan: 1,
};

const defaultMinimumFresh = {
  korea: 50,
  china: 50,
  japan: 50,
  uae: 50,
  europe: 100,
  georgia: 20,
  kyrgyzstan: 20,
};

function parseMinimumFresh() {
  const configured = String(process.env.CATALOG_PUBLISH_MIN_FRESH_BY_MARKET || "").trim();
  if (!configured) return defaultMinimumFresh;
  try {
    return { ...defaultMinimumFresh, ...JSON.parse(configured) };
  } catch (error) {
    return { ...defaultMinimumFresh, __configError: String(error?.message || error) };
  }
}

function imageKey(image) {
  return String(image?.checksum || image?.id || image?.objectKey || image?.url || "");
}

function validateOffer(offer) {
  const errors = [];
  const images = Array.isArray(offer?.images) ? offer.images : [];
  const uniqueImages = new Set(images.map(imageKey).filter(Boolean));
  if (!offer?.id || !offer?.sourceId || !offer?.market) errors.push("identity");
  if (!offer?.operational?.sourceUrl) errors.push("source_url");
  if (!Number.isFinite(Number(offer?.sourcePrice)) || Number(offer?.sourcePrice) <= 0) errors.push("source_price");
  if (!Number.isFinite(Number(offer?.totalRub)) || Number(offer?.totalRub) <= 0) errors.push("total_rub");
  if (!images.length || uniqueImages.size !== images.length) errors.push("images");
  const missingSpecification = catalogRequiredSpecificationRejectionReason(offer);
  if (missingSpecification) errors.push(missingSpecification);
  const customs = offer?.calculationSnapshot?.customs;
  if (customs?.status !== "ready" || !Number.isFinite(Number(customs?.totalCustomsRub))) errors.push("customs");
  const breakdown = offer?.calculationSnapshot?.breakdown;
  if (!Array.isArray(breakdown) || !breakdown.some((line) => line?.id === "customs") || !breakdown.some((line) => line?.id === "car")) errors.push("price_breakdown");
  return errors;
}

const minimumFresh = parseMinimumFresh();
let filenames = [];
try {
  filenames = (await fs.readdir(inputDir)).filter((name) => /^catalog-rebuild-.+\.json$/.test(name)).sort();
} catch {
  filenames = [];
}

const payloads = [];
const probePayloads = [];
const fileErrors = [];
for (const name of filenames) {
  const filename = path.join(inputDir, name);
  try {
    const payload = JSON.parse(await fs.readFile(filename, "utf8"));
    if (!payload?.market || !Array.isArray(payload?.offers)) throw new Error("invalid_generation_payload");
    payloads.push({ filename, payload });
  } catch (error) {
    fileErrors.push({ filename, error: String(error?.message || error) });
  }
}

let probeFilenames = [];
try {
  probeFilenames = (await fs.readdir(inputDir)).filter((name) => /^catalog-v3-probe-.+-\d+\.json$/.test(name)).sort();
} catch {
  probeFilenames = [];
}
for (const name of probeFilenames) {
  const filename = path.join(inputDir, name);
  try {
    const payload = JSON.parse(await fs.readFile(filename, "utf8"));
    if (!payload?.market || !Array.isArray(payload?.results)) throw new Error("invalid_probe_payload");
    probePayloads.push({ filename, payload });
  } catch (error) {
    fileErrors.push({ filename, error: String(error?.message || error) });
  }
}

const byMarket = {};
const warnings = [];
const publishableMarkets = [];
for (const market of markets) {
  const marketPayloads = payloads.filter(({ payload }) => payload.market === market);
  const freshIds = new Set();
  const restoredIds = new Set();
  const validIds = new Set();
  const freshBySource = new Map();
  const candidatesBySource = new Map();
  const invalid = [];
  const processFailures = [];
  const marketProbes = probePayloads.filter(({ payload }) => payload.market === market);
  const requiredSourceIds = new Set(marketProbes.flatMap(({ payload }) => payload.requiredSourceIds || []));
  const requiredActiveSourceIds = new Set(marketProbes.flatMap(({ payload }) => payload.requiredActiveSourceIds || []));
  const activeSourceIds = new Set(marketProbes.flatMap(({ payload }) => payload.activeSourceIds || []));
  const missingRequiredAdapters = new Set(marketProbes.flatMap(({ payload }) => payload.missingRequiredAdapters || []));
  const requiredInactiveSourceIds = [...requiredSourceIds].filter((sourceId) => !requiredActiveSourceIds.has(sourceId));
  const collectorSourceReports = marketPayloads.flatMap(({ payload }) => Array.isArray(payload?.report?.sources) ? payload.report.sources : []);
  const collectorLiveSourceIds = new Set(marketPayloads.flatMap(({ payload }) => [
    ...(Array.isArray(payload?.liveSourceIds) ? payload.liveSourceIds : []),
    ...(Array.isArray(payload?.report?.liveSourceIds) ? payload.report.liveSourceIds : []),
  ]));
  const requiredAttemptedSourceIds = [...requiredSourceIds].filter((sourceId) => collectorLiveSourceIds.has(sourceId));
  const requiredUnattemptedSourceIds = [...requiredSourceIds].filter((sourceId) => !collectorLiveSourceIds.has(sourceId));
  const requiredHealthySourceIds = [...requiredSourceIds].filter((sourceId) => collectorSourceReports.some((source) =>
    source?.sourceId === sourceId
    && source?.mode === "live"
    && Number(source?.pages || 0) > 0
    && String(source?.stopReason || "") !== "source_errors"));
  const requiredUnhealthySourceIds = [...requiredSourceIds].filter((sourceId) => !requiredHealthySourceIds.includes(sourceId));

  for (const { filename, payload } of marketPayloads) {
    if (["rebuild_process_failed", "collection_not_completed"].includes(payload.stopReason)
      || ["rebuild_process_failed", "collection_not_completed"].includes(payload.report?.stopReason)) processFailures.push(filename);
    for (const offer of payload.offers) {
      const sourceId = String(offer?.sourceId || "unknown");
      candidatesBySource.set(sourceId, Number(candidatesBySource.get(sourceId) || 0) + 1);
      const errors = validateOffer(offer);
      if (errors.length) {
        if (invalid.length < 100) invalid.push({ id: offer?.id, sourceId: offer?.sourceId, errors });
        continue;
      }
      validIds.add(offer.id);
      const origin = String(offer?.operational?.galleryRebuiltFrom || "");
      if (origin === "fresh_listing") {
        freshIds.add(offer.id);
        freshBySource.set(sourceId, Number(freshBySource.get(sourceId) || 0) + 1);
      } else {
        restoredIds.add(offer.id);
      }
    }
  }

  const requiredProductiveSourceIds = [...requiredSourceIds].filter((sourceId) => Number(candidatesBySource.get(sourceId) || 0) > 0);
  const requiredUnproductiveSourceIds = [...requiredSourceIds].filter((sourceId) => !requiredProductiveSourceIds.includes(sourceId));
  const requiredFreshProductiveSourceIds = [...requiredSourceIds].filter((sourceId) => Number(freshBySource.get(sourceId) || 0) > 0);
  const requiredFreshUnproductiveSourceIds = [...requiredSourceIds].filter((sourceId) => !requiredFreshProductiveSourceIds.includes(sourceId));
  const threshold = Math.max(1, Number(minimumFresh[market] || 1));
  const minimumProductiveSources = Math.max(1, configuredMinimumProductiveSources || Number(defaultMinimumProductiveSources[market] || 2));
  const productiveSources = [...candidatesBySource.values()].filter((count) => count > 0).length;
  const requiredSourcesAttempted = marketPayloads.length > 0
    && requiredSourceIds.size > 0
    && missingRequiredAdapters.size === 0
    && requiredUnattemptedSourceIds.length === 0;
  const requiredSourcesHealthy = requiredSourcesAttempted
    && requiredUnhealthySourceIds.length === 0
    && requiredUnproductiveSourceIds.length === 0;
  const requiredSourceContinuity = requiredSourcesAttempted && requiredProductiveSourceIds.length > 0;
  const row = {
    artifacts: marketPayloads.length,
    valid: validIds.size,
    fresh: freshIds.size,
    restored: restoredIds.size,
    target: targetPerMarket,
    shortage: Math.max(0, targetPerMarket - validIds.size),
    marketTargetReached: validIds.size >= targetPerMarket,
    freshThreshold: threshold,
    freshThresholdReached: freshIds.size >= threshold,
    productiveSources,
    minimumProductiveSources,
    sourceTargetReached: productiveSources >= minimumProductiveSources,
    freshBySource: Object.fromEntries([...freshBySource.entries()].sort(([left], [right]) => left.localeCompare(right))),
    candidatesBySource: Object.fromEntries([...candidatesBySource.entries()].sort(([left], [right]) => left.localeCompare(right))),
    invalidOffers: invalid,
    processFailures,
    sourceProbeArtifacts: marketProbes.length,
    activeSourceIds: [...activeSourceIds].sort(),
    requiredSourceIds: [...requiredSourceIds].sort(),
    requiredActiveSourceIds: [...requiredActiveSourceIds].sort(),
    requiredInactiveSourceIds: requiredInactiveSourceIds.sort(),
    missingRequiredAdapters: [...missingRequiredAdapters].sort(),
    collectorLiveSourceIds: [...collectorLiveSourceIds].sort(),
    requiredAttemptedSourceIds: requiredAttemptedSourceIds.sort(),
    requiredUnattemptedSourceIds: requiredUnattemptedSourceIds.sort(),
    requiredHealthySourceIds: requiredHealthySourceIds.sort(),
    requiredUnhealthySourceIds: requiredUnhealthySourceIds.sort(),
    requiredProductiveSourceIds: requiredProductiveSourceIds.sort(),
    requiredUnproductiveSourceIds: requiredUnproductiveSourceIds.sort(),
    requiredFreshProductiveSourceIds: requiredFreshProductiveSourceIds.sort(),
    requiredFreshUnproductiveSourceIds: requiredFreshUnproductiveSourceIds.sort(),
    requiredSourcesAttempted,
    requiredSourcesHealthy,
    requiredSourceContinuity,
    // Availability is the hard contract: every configured canonical source must
    // reach the real collector. Complete/healthy is diagnostic because external
    // sites may temporarily return 403/429 or require login. Such an outage must
    // be visible, but must not erase an otherwise healthy multi-source market.
    requiredSourcesAvailable: requiredSourcesAttempted,
    requiredSourcesComplete: requiredSourcesHealthy,
    stopReasons: marketPayloads.map(({ payload }) => payload.stopReason || payload.report?.stopReason || "unknown"),
  };
  byMarket[market] = row;
  if (validIds.size > 0) publishableMarkets.push(market);
  if (!marketPayloads.length) warnings.push(`${market}:missing_artifacts`);
  if (!marketProbes.length) warnings.push(`${market}:missing_probe_artifacts`);
  if (row.requiredUnattemptedSourceIds.length) warnings.push(`${market}:required_sources_unattempted:${row.requiredUnattemptedSourceIds.join(",")}`);
  if (row.requiredUnhealthySourceIds.length) warnings.push(`${market}:required_sources_unhealthy:${row.requiredUnhealthySourceIds.join(",")}`);
  if (row.requiredUnproductiveSourceIds.length) warnings.push(`${market}:required_sources_unproductive:${row.requiredUnproductiveSourceIds.join(",")}`);
  if (row.requiredFreshUnproductiveSourceIds.length) warnings.push(`${market}:required_sources_without_fresh_verified_rows:${row.requiredFreshUnproductiveSourceIds.join(",")}`);
  if (!row.requiredSourcesComplete) warnings.push(`${market}:required_sources_degraded`);
  if (processFailures.length) warnings.push(`${market}:rebuild_process_failed`);
  if (freshIds.size < threshold) warnings.push(`${market}:fresh_${freshIds.size}_below_${threshold}`);
  if (validIds.size < targetPerMarket) warnings.push(`${market}:valid_${validIds.size}_below_${targetPerMarket}`);
  if (productiveSources < minimumProductiveSources) warnings.push(`${market}:productive_sources_${productiveSources}_below_${minimumProductiveSources}`);
  if (!requiredSourceContinuity) warnings.push(`${market}:no_productive_required_source`);
  if (invalid.length) warnings.push(`${market}:invalid_offers_${invalid.length}`);
}

if (fileErrors.length) warnings.push(`generation_file_errors_${fileErrors.length}`);
if (minimumFresh.__configError) warnings.push(`minimum_fresh_config:${minimumFresh.__configError}`);

const degradedMarkets = markets.filter((market) => !byMarket[market]?.marketTargetReached || !byMarket[market]?.sourceTargetReached || !byMarket[market]?.requiredSourcesComplete);
const blockingMarkets = markets.filter((market) => {
  const row = byMarket[market];
  // Required sources are never allowed to disappear silently: every canonical
  // adapter must be registered and attempted. A temporary external 403/429 or
  // zero-fresh result is degraded telemetry, not a reason to throw away a
  // multi-source run that still contains valid verified inventory. We still
  // require multiple productive independent sources (one for Kyrgyzstan) and at
  // least one productive canonical source before a new generation may publish.
  return !row
    || row.artifacts === 0
    || row.sourceProbeArtifacts === 0
    || row.processFailures.length > 0
    || row.valid <= 0
    || !row.requiredSourcesAttempted
    || !row.requiredSourceContinuity
    || (market === "georgia" && row.requiredFreshUnproductiveSourceIds.length > 0)
    || !row.sourceTargetReached;
});
const report = {
  version: 26,
  checkedAt: new Date().toISOString(),
  mode: "per_market_volume_and_integrity_audit_with_source_continuity",
  inputDir,
  files: filenames,
  probeFiles: probeFilenames,
  fileErrors,
  targetPerMarket,
  minimumFresh,
  minimumProductiveSourcesByMarket: defaultMinimumProductiveSources,
  configuredMinimumProductiveSources,
  byMarket,
  publishableMarkets,
  degradedMarkets,
  blockingMarkets,
  volumeTargetReached: degradedMarkets.length === 0,
  integrityOk: Object.values(byMarket).every((row) => row.invalidOffers.length === 0),
  warnings,
  ok: blockingMarkets.length === 0,
};

await fs.writeFile(outputFile, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
