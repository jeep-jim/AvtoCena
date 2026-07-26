import fs from "node:fs/promises";
import path from "node:path";

const inputDir = process.env.CATALOG_REBUILD_INPUT_DIR || "catalog-rebuild";
const markets = String(process.env.CATALOG_REBUILD_MARKETS || "korea,china,japan,uae,europe,georgia,kyrgyzstan")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const outputFile = process.env.CATALOG_REBUILD_VALIDATION_REPORT || "catalog-source-scale-validation-report.json";
const minimumProductiveSources = Math.max(1, Number(process.env.CATALOG_PUBLISH_MIN_PRODUCTIVE_SOURCES || 1));

const defaultMinimumFresh = {
  korea: 50,
  china: 50,
  japan: 50,
  uae: 50,
  europe: 300,
  georgia: 10,
  kyrgyzstan: 10,
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

function hasExactElectrifiedPower(offer) {
  const kind = String(offer?.powertrainKind || "");
  if (!["electric", "series_hybrid", "other_hybrid"].includes(kind)) return true;
  if (Number(offer?.utilizationPowerKw || 0) > 0) return true;
  const motorPower = Number(offer?.power30MinKw || 0)
    || (Array.isArray(offer?.power30MinKwByMotor)
      ? offer.power30MinKwByMotor.reduce((sum, value) => sum + Math.max(0, Number(value || 0)), 0)
      : 0);
  if (kind === "electric" || kind === "series_hybrid") return motorPower > 0;
  return motorPower > 0 && Number(offer?.icePowerKw || 0) > 0;
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
  if (!hasExactElectrifiedPower(offer)) errors.push("certified_utilization_power");
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

const byMarket = {};
const warnings = [];
const publishableMarkets = [];
for (const market of markets) {
  const marketPayloads = payloads.filter(({ payload }) => payload.market === market);
  const freshIds = new Set();
  const restoredIds = new Set();
  const validIds = new Set();
  const freshBySource = new Map();
  const invalid = [];
  const processFailures = [];

  for (const { filename, payload } of marketPayloads) {
    if (payload.stopReason === "rebuild_process_failed" || payload.report?.stopReason === "rebuild_process_failed") processFailures.push(filename);
    for (const offer of payload.offers) {
      const errors = validateOffer(offer);
      if (errors.length) {
        if (invalid.length < 100) invalid.push({ id: offer?.id, sourceId: offer?.sourceId, errors });
        continue;
      }
      validIds.add(offer.id);
      const origin = String(offer?.operational?.galleryRebuiltFrom || "");
      if (origin === "fresh_listing") {
        freshIds.add(offer.id);
        const sourceId = String(offer.sourceId || "unknown");
        freshBySource.set(sourceId, Number(freshBySource.get(sourceId) || 0) + 1);
      } else {
        restoredIds.add(offer.id);
      }
    }
  }

  const threshold = Math.max(1, Number(minimumFresh[market] || 1));
  const productiveSources = [...freshBySource.values()].filter((count) => count > 0).length;
  const row = {
    artifacts: marketPayloads.length,
    valid: validIds.size,
    fresh: freshIds.size,
    restored: restoredIds.size,
    threshold,
    volumeTargetReached: freshIds.size >= threshold,
    productiveSources,
    minimumProductiveSources,
    sourceTargetReached: productiveSources >= minimumProductiveSources,
    freshBySource: Object.fromEntries([...freshBySource.entries()].sort(([left], [right]) => left.localeCompare(right))),
    invalidOffers: invalid,
    processFailures,
    stopReasons: marketPayloads.map(({ payload }) => payload.stopReason || payload.report?.stopReason || "unknown"),
  };
  byMarket[market] = row;
  if (validIds.size > 0) publishableMarkets.push(market);
  if (!marketPayloads.length) warnings.push(`${market}:missing_artifacts`);
  if (processFailures.length) warnings.push(`${market}:rebuild_process_failed`);
  if (freshIds.size < threshold) warnings.push(`${market}:fresh_${freshIds.size}_below_${threshold}`);
  if (productiveSources < minimumProductiveSources) warnings.push(`${market}:productive_sources_${productiveSources}_below_${minimumProductiveSources}`);
  if (invalid.length) warnings.push(`${market}:invalid_offers_${invalid.length}`);
}

if (fileErrors.length) warnings.push(`generation_file_errors_${fileErrors.length}`);
if (minimumFresh.__configError) warnings.push(`minimum_fresh_config:${minimumFresh.__configError}`);

const report = {
  version: 21,
  checkedAt: new Date().toISOString(),
  mode: "per_market_advisory_gate",
  inputDir,
  files: filenames,
  fileErrors,
  minimumFresh,
  minimumProductiveSources,
  byMarket,
  publishableMarkets,
  degradedMarkets: markets.filter((market) => !byMarket[market]?.volumeTargetReached || !byMarket[market]?.sourceTargetReached),
  integrityOk: Object.values(byMarket).every((row) => row.invalidOffers.length === 0),
  warnings,
  ok: true,
};

await fs.writeFile(outputFile, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
