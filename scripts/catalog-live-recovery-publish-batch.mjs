import fs from "node:fs/promises";
import path from "node:path";

const { persistCatalogOffers, readMarketOffers } = await import("../apps/web/lib/catalog/storage.ts");
const { credibleCatalogImages, isCatalogOfferBusinessLiquid, hasCredibleOfferContent, catalogMinYearForMarket, isCatalogYearAllowed } = await import("../apps/web/lib/catalog/offer-quality.ts");
const { normalizeVehicleOfferSpecs } = await import("../apps/web/lib/catalog/spec-normalization.ts");
const { isPreliminaryPowerPendingCalculation } = await import("../apps/web/lib/catalog/customs-pricing.ts");
const { PUBLIC_CATALOG_MARKETS, CATALOG_RETENTION_MS, CATALOG_MAX_PUBLIC_OFFERS_PER_MARKET } = await import("../apps/web/lib/catalog/runtime-config.ts");
const { CATALOG_MAX_OFFERS_PER_MODEL_YEAR, catalogModelYearQuotaKey, catalogExactModelKey } = await import("../apps/web/lib/catalog/inventory-quota.ts");

const markets = String(process.env.RECOVERY_BATCH_MARKETS || "uae,georgia")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const inputDir = String(process.env.RECOVERY_BATCH_INPUT_DIR || "recovery-input").trim();
const output = String(process.env.RECOVERY_BATCH_REPORT || "catalog-direct-recovery-batch-publish-report.json").trim();
const dryRun = /^(1|true|yes)$/i.test(String(process.env.RECOVERY_BATCH_DRY_RUN || ""));
const maxPerMarket = Math.max(1, Math.min(CATALOG_MAX_PUBLIC_OFFERS_PER_MARKET || 100_000, Number(process.env.RECOVERY_PUBLISH_MAX || CATALOG_MAX_PUBLIC_OFFERS_PER_MARKET || 100_000)));
const preferredMaxRub = Math.max(500_000, Number(process.env.RECOVERY_PREFERRED_MAX_RUB || 8_000_000));
const maxOffersPerModelYear = CATALOG_MAX_OFFERS_PER_MODEL_YEAR;
const minImagesPerOffer = Math.max(1, Math.min(30, Number(process.env.CATALOG_REBUILD_MIN_IMAGES_PER_OFFER || 5)));
const retentionMs = Math.max(60 * 60 * 1_000, Number(process.env.CATALOG_OFFER_RETENTION_MS || CATALOG_RETENTION_MS || 259_200_000));
const retentionCutoff = Date.now() - retentionMs;

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
  return Date.parse(String(offer?.operational?.sourcePublishedAt || offer?.updatedAt || offer?.firstSeenAt || "")) || 0;
}
function withinRetention(offer) {
  const timestamp = freshness(offer);
  return timestamp > 0 && timestamp >= retentionCutoff;
}
function koreaKnownSedanIdentity(offer) {
  const make = String(offer?.make || "").trim();
  const identity = [offer?.model, offer?.trim, offer?.sourceTitle].filter(Boolean).join(" ");
  if (/^(?:genesis|제네시스)$/i.test(make)) return /\bG80\b/i.test(identity);
  if (/^(?:hyundai|현대)$/i.test(make)) return /(?:\bGrandeur\b|그랜저|\bIoniq\s*6\b|아이오닉\s*6)/i.test(identity);
  if (/^(?:kia|기아)$/i.test(make)) return /(?:\bK9\b|\bK900\b|\bQuoris\b|퀴리스)/i.test(identity);
  return false;
}
function semanticBodyValid(offer, currentMarket) {
  if (currentMarket !== "korea") return true;
  if (!koreaKnownSedanIdentity(offer)) return true;
  return !/^(?:suv|crossover|offroad)$/i.test(String(offer?.bodyType || ""));
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
for (const market of markets) {
  const input = path.join(inputDir, `catalog-rebuild-${market}.json`);
  const payload = JSON.parse(await fs.readFile(input, "utf8"));
  const sourceRows = Array.isArray(payload?.offers) ? payload.offers : [];
  const incoming = new Map();
  const rejected = {};
  const reject = (reason) => { rejected[reason] = Number(rejected[reason] || 0) + 1; };
  for (const raw of sourceRows) {
    const offer = normalizeVisible(raw);
    if (!offer?.id || incoming.has(offer.id)) continue;
    if (offer.market !== market) { reject("market"); continue; }
    const year = Number(offer.year || 0);
    if (!isCatalogYearAllowed(year, market)) { reject("year"); continue; }
    if (!isCatalogOfferBusinessLiquid(offer)) { reject("business_liquidity"); continue; }
    if (!offer.make || !offer.model) { reject("visible_core"); continue; }
    if (!semanticBodyValid(offer, market)) { reject("semantic_body"); continue; }
    if (offer.images.length < minImagesPerOffer) { reject("images"); continue; }
    if (!exactSourceBound(offer)) { reject("source_binding"); continue; }
    if (!publishableCalculation(offer)) { reject("calculation"); continue; }
    if (!canonicalPublic(offer)) { reject("public_quality"); continue; }
    incoming.set(offer.id, offer);
  }

  let previous = [];
  try { previous = await readMarketOffers(market); } catch { previous = []; }
  const candidates = new Map();
  for (const raw of previous) {
    const offer = normalizeVisible(raw);
    const year = Number(offer?.year || 0);
    if (!offer?.id || !["active", "stale"].includes(String(raw?.status || ""))) continue;
    if (!isCatalogYearAllowed(year, market) || !offer.make || !offer.model || offer.images.length < minImagesPerOffer) continue;
    if (!semanticBodyValid(offer, market)) { reject("retained_semantic_body"); continue; }
    if (!withinRetention(offer) || !publicExistingStillValid(offer)) continue;
    candidates.set(offer.id, offer);
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
  incomingIdsByMarket.set(market, new Set(incoming.keys()));
  rejectedByMarket[market] = rejected;
}

const combined = [];
for (const marketRows of selectedByMarket.values()) combined.push(...marketRows);
const preservedByMarket = {};
for (const other of PUBLIC_CATALOG_MARKETS) {
  if (markets.includes(other)) continue;
  let rows = [];
  try { rows = await readMarketOffers(other); } catch { rows = [];
  }
  const preserved = rows
    .filter((offer) => ["active", "stale"].includes(String(offer?.status || "")))
    .map((offer) => normalizeVisible(offer))
    .filter((offer) => offer.id && offer.make && offer.model && isCatalogYearAllowed(offer.year, other) && offer.images.length > 0 && withinRetention(offer) && canonicalPublic(offer) && isCatalogOfferBusinessLiquid(offer) && semanticBodyValid(offer, other))
    .slice(0, CATALOG_MAX_PUBLIC_OFFERS_PER_MARKET || 100_000);
  preservedByMarket[other] = preserved.length;
  combined.push(...preserved);
}

const marketReports = {};
for (const market of markets) {
  const rows = selectedByMarket.get(market) || [];
  const incomingIds = incomingIdsByMarket.get(market) || new Set();
  marketReports[market] = {
    count: rows.length,
    incomingCount: rows.filter((offer) => incomingIds.has(offer.id)).length,
    retainedCount: rows.filter((offer) => !incomingIds.has(offer.id)).length,
    preferredCount: rows.filter((offer) => Number(offer.totalRub || 0) <= preferredMaxRub).length,
    calculatedCount: rows.filter(exactCalculation).length,
    preliminaryCount: rows.filter(isPreliminaryPowerPendingCalculation).length,
    minYear: catalogMinYearForMarket(market),
    retentionMs,
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
    byMarket: marketReports,
    preservedByMarket,
  };
  await fs.writeFile(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

const unique = new Map();
for (const offer of combined) if (offer?.id && !unique.has(offer.id)) unique.set(offer.id, offer);
process.env.CATALOG_GROW_ONLY_MARKETS = "";
const manifest = await persistCatalogOffers([...unique.values()]);

for (const market of markets) {
  const rows = selectedByMarket.get(market) || [];
  const manifestCount = Number(manifest?.markets?.[market]?.count || 0);
  if (manifestCount !== rows.length) {
    const debugReport = {
      version: 5,
      mode: "live_markets_publishable_cumulative_batch_publish",
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
}

const report = {
  version: 5,
  mode: "live_markets_publishable_cumulative_batch_publish",
  markets,
  publishedAt: new Date().toISOString(),
  published: true,
  generationId: manifest.generationId,
  retentionMs,
  minImagesPerOffer,
  byMarket: marketReports,
  preservedByMarket,
  manifestCounts: Object.fromEntries(PUBLIC_CATALOG_MARKETS.map((market) => [market, Number(manifest?.markets?.[market]?.count || 0)])),
};
await fs.writeFile(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));