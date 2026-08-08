import fs from "node:fs/promises";
import path from "node:path";

const { persistCatalogOffers, readMarketOffers } = await import("../apps/web/lib/catalog/storage.ts");
const { credibleCatalogImages } = await import("../apps/web/lib/catalog/offer-quality.ts");
const { normalizeVehicleOfferSpecs } = await import("../apps/web/lib/catalog/spec-normalization.ts");
const { PUBLIC_CATALOG_MARKETS } = await import("../apps/web/lib/catalog/runtime-config.ts");

const markets = String(process.env.RECOVERY_BATCH_MARKETS || "uae,georgia")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const inputDir = String(process.env.RECOVERY_BATCH_INPUT_DIR || "recovery-input").trim();
const output = String(process.env.RECOVERY_BATCH_REPORT || "catalog-direct-recovery-batch-publish-report.json").trim();
const maxPerMarket = Math.max(1, Math.min(5_000, Number(process.env.RECOVERY_PUBLISH_MAX || 3_000)));
const preferredMaxRub = Math.max(500_000, Number(process.env.RECOVERY_PREFERRED_MAX_RUB || 8_000_000));
const maxOffersPerModel = Math.max(1, Math.min(100, Number(process.env.CATALOG_MAX_OFFERS_PER_MODEL || 20)));
const maxModelsPerMake = Math.max(1, Math.min(50, Number(process.env.CATALOG_MAX_MODELS_PER_MAKE || 10)));
const minYear = new Date().getFullYear() - 15;

if (!markets.length || markets.some((market) => !PUBLIC_CATALOG_MARKETS.includes(market))) {
  throw new Error(`recovery_batch_markets_invalid:${markets.join(",")}`);
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

function quality(a, b) {
  const ap = Number(a.totalRub || 0) <= preferredMaxRub ? 0 : 1;
  const bp = Number(b.totalRub || 0) <= preferredMaxRub ? 0 : 1;
  return ap - bp
    || Number(b.year || 0) - Number(a.year || 0)
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
function modelKey(offer) {
  const make = makeKey(offer);
  const model = String(offer?.model || "").trim().toLocaleLowerCase("en-US").replace(/\s+/g, " ");
  return make && model ? `${make}|${model}` : "";
}
function applyDiversity(rows, rejected) {
  const selected = [];
  const modelsByMake = new Map();
  const countByModel = new Map();
  for (const offer of rows) {
    const make = makeKey(offer);
    const model = modelKey(offer);
    if (!make || !model) continue;
    const knownModels = modelsByMake.get(make) || new Set();
    if (!knownModels.has(model) && knownModels.size >= maxModelsPerMake) {
      rejected.model_quota = Number(rejected.model_quota || 0) + 1;
      continue;
    }
    if (Number(countByModel.get(model) || 0) >= maxOffersPerModel) {
      rejected.make_model_quota = Number(rejected.make_model_quota || 0) + 1;
      continue;
    }
    knownModels.add(model);
    modelsByMake.set(make, knownModels);
    countByModel.set(model, Number(countByModel.get(model) || 0) + 1);
    selected.push(offer);
    if (selected.length >= maxPerMarket) break;
  }
  return selected;
}

const selectedByMarket = new Map();
const rejectedByMarket = {};
for (const market of markets) {
  const input = path.join(inputDir, `catalog-rebuild-${market}.json`);
  const payload = JSON.parse(await fs.readFile(input, "utf8"));
  const sourceRows = Array.isArray(payload?.offers) ? payload.offers : [];
  const seen = new Set();
  const selected = [];
  const rejected = {};
  const reject = (reason) => { rejected[reason] = Number(rejected[reason] || 0) + 1; };
  for (const raw of sourceRows) {
    const offer = normalizeVisible(raw);
    if (!offer?.id || seen.has(offer.id)) continue;
    seen.add(offer.id);
    if (offer.market !== market) { reject("market"); continue; }
    const year = Number(offer.year || 0);
    if (year < minYear || year > new Date().getFullYear() + 1) { reject("year"); continue; }
    if (!offer.make || !offer.model || !offer.images.length) { reject("visible_core"); continue; }
    if (!exactSourceBound(offer)) { reject("source_binding"); continue; }
    if (!exactCalculation(offer)) { reject("calculation"); continue; }
    selected.push(offer);
  }
  selected.sort(quality);
  const marketRows = applyDiversity(selected, rejected);
  if (!marketRows.length) throw new Error(`recovery_batch_empty_market:${market}`);
  selectedByMarket.set(market, marketRows);
  rejectedByMarket[market] = rejected;
}

const combined = [];
for (const marketRows of selectedByMarket.values()) combined.push(...marketRows);
const preservedByMarket = {};
for (const other of PUBLIC_CATALOG_MARKETS) {
  if (markets.includes(other)) continue;
  let rows = [];
  try { rows = await readMarketOffers(other); } catch { rows = []; }
  const preserved = rows
    .filter((offer) => ["active", "stale"].includes(String(offer?.status || "")))
    .map((offer) => normalizeVisible(offer))
    .filter((offer) => offer.id && offer.make && offer.model && Number(offer.year || 0) >= minYear && offer.images.length > 0)
    .slice(0, 5_000);
  preservedByMarket[other] = preserved.length;
  combined.push(...preserved);
}

const unique = new Map();
for (const offer of combined) if (offer?.id && !unique.has(offer.id)) unique.set(offer.id, offer);
process.env.CATALOG_GROW_ONLY_MARKETS = "";
const manifest = await persistCatalogOffers([...unique.values()]);

const marketReports = {};
for (const market of markets) {
  const rows = selectedByMarket.get(market) || [];
  const manifestCount = Number(manifest?.markets?.[market]?.count || 0);
  if (manifestCount !== rows.length) {
    const debugReport = {
      version: 2,
      mode: "live_markets_exact_calculated_batch_publish",
      markets,
      published: false,
      generationId: manifest?.generationId || null,
      failure: `recovery_batch_manifest_mismatch:${market}:${manifestCount}:${rows.length}`,
      selectedCounts: Object.fromEntries(markets.map((item) => [item, (selectedByMarket.get(item) || []).length])),
      manifestCounts: Object.fromEntries(PUBLIC_CATALOG_MARKETS.map((item) => [item, Number(manifest?.markets?.[item]?.count || 0)])),
      preservedByMarket,
    };
    await fs.writeFile(output, JSON.stringify(debugReport, null, 2));
    throw new Error(debugReport.failure);
  }
  marketReports[market] = {
    count: rows.length,
    preferredCount: rows.filter((offer) => Number(offer.totalRub || 0) <= preferredMaxRub).length,
    calculatedCount: rows.filter(exactCalculation).length,
    minYear,
    preferredMaxRub,
    maxOffersPerModel,
    maxModelsPerMake,
    distinctModels: new Set(rows.map(modelKey)).size,
    distinctMakes: new Set(rows.map(makeKey)).size,
    sourceCounts: Object.fromEntries([...new Set(rows.map((offer) => String(offer.sourceId || "unknown")))].map((sourceId) => [sourceId, rows.filter((offer) => String(offer.sourceId || "unknown") === sourceId).length])),
    imageStats: {
      min: Math.min(...rows.map((offer) => offer.images.length)),
      max: Math.max(...rows.map((offer) => offer.images.length)),
      average: Number((rows.reduce((sum, offer) => sum + offer.images.length, 0) / rows.length).toFixed(2)),
    },
    rejected: rejectedByMarket[market],
  };
}

const report = {
  version: 2,
  mode: "live_markets_exact_calculated_batch_publish",
  markets,
  publishedAt: new Date().toISOString(),
  published: true,
  generationId: manifest.generationId,
  byMarket: marketReports,
  preservedByMarket,
  manifestCounts: Object.fromEntries(PUBLIC_CATALOG_MARKETS.map((market) => [market, Number(manifest?.markets?.[market]?.count || 0)])),
};
await fs.writeFile(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
