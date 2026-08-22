import fs from "node:fs/promises";

const { persistCatalogOffers, readAllOffersForMaintenance, readMarketOffers } = await import("../apps/web/lib/catalog/storage.ts");
const {
  credibleCatalogImages,
  hasCredibleOfferContent,
  isCatalogMarketSourceAllowed,
  isCatalogOfferBusinessLiquid,
  isCatalogYearAllowed,
} = await import("../apps/web/lib/catalog/offer-quality.ts");
const { normalizeVehicleOfferSpecs } = await import("../apps/web/lib/catalog/spec-normalization.ts");
const { enrichOfferWithKnowledgeCore } = await import("../apps/web/lib/catalog/knowledge-core.ts");
const { isPreliminaryPowerPendingCalculation } = await import("../apps/web/lib/catalog/customs-pricing.ts");
const { PUBLIC_CATALOG_MARKETS } = await import("../apps/web/lib/catalog/runtime-config.ts");
const { CATALOG_MAX_OFFERS_PER_MODEL_YEAR, catalogModelYearQuotaKey } = await import("../apps/web/lib/catalog/inventory-quota.ts");

const input = String(process.env.GEORGIA_REPLACE_INPUT || "recovery-input/catalog-rebuild-georgia.json");
const output = String(process.env.GEORGIA_REPLACE_REPORT || "georgia-replace-report.json");
const dryRun = /^(1|true|yes)$/i.test(String(process.env.GEORGIA_REPLACE_DRY_RUN || ""));
const minGeorgia = Math.max(1, Number(process.env.GEORGIA_REPLACE_MIN_COUNT || 2_000));
const maxGeorgia = Math.max(minGeorgia, Number(process.env.GEORGIA_REPLACE_MAX_COUNT || 5_000));
const maxPerModelYear = CATALOG_MAX_OFFERS_PER_MODEL_YEAR;
const canonicalGeorgiaSources = new Set(["myauto_georgia_list", "autopapa_georgia_open"]);

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

function publicLike(offer) {
  return String(offer?.status || "") === "active" && hasCredibleOfferContent(offer);
}

function sourceHostAllowed(offer) {
  const sourceId = String(offer?.sourceId || "");
  const sourceUrl = String(offer?.operational?.sourceUrl || "");
  if (!canonicalGeorgiaSources.has(sourceId) || !sourceUrl) return false;
  try {
    const host = new URL(sourceUrl).hostname.toLowerCase();
    return sourceId === "myauto_georgia_list"
      ? (host === "myauto.ge" || host.endsWith(".myauto.ge") || host === "api2.myauto.ge")
      : host === "autopapa.ge";
  } catch {
    return false;
  }
}

function sourceBound(offer) {
  const raw = offer?.operational?.raw || {};
  return raw.recoveryExactSourceUrl === true
    && raw.recoveryExactPhotoIdentity === true
    && raw.recoveryCalculatedRub === true
    && raw.recoveryBodySourceOnly === true;
}

function quality(left, right) {
  return Number(right.year || 0) - Number(left.year || 0)
    || Number(right.images?.length || 0) - Number(left.images?.length || 0)
    || Number(left.totalRub || Number.MAX_SAFE_INTEGER) - Number(right.totalRub || Number.MAX_SAFE_INTEGER)
    || String(left.id || "").localeCompare(String(right.id || ""));
}

const payload = JSON.parse(await fs.readFile(input, "utf8"));
const rejected = {};
const reject = (reason) => { rejected[reason] = Number(rejected[reason] || 0) + 1; };
const incoming = new Map();
for (const raw of Array.isArray(payload?.offers) ? payload.offers : []) {
  const offer = normalizeVehicleOfferSpecs({
    ...raw,
    images: credibleCatalogImages(raw?.images || []).slice(0, 30),
  });
  if (!offer?.id || incoming.has(offer.id)) continue;
  if (offer.market !== "georgia") { reject("market"); continue; }
  if (!isCatalogYearAllowed(offer.year, "georgia")) { reject("year"); continue; }
  if (!canonicalGeorgiaSources.has(String(offer.sourceId || "")) || !isCatalogMarketSourceAllowed(offer) || !sourceHostAllowed(offer)) { reject("source"); continue; }
  if (!sourceBound(offer)) { reject("source_binding"); continue; }
  if (!(Number(offer.sourcePrice || 0) > 0) || !String(offer.sourceCurrency || "").trim() || !(Number(offer.totalRub || 0) > 0)) { reject("price"); continue; }
  if (!Array.isArray(offer.images) || offer.images.length < 5) { reject("gallery_below_five"); continue; }
  if (!publishableCalculation(offer)) { reject("calculation"); continue; }
  if (!isCatalogOfferBusinessLiquid(offer) || !publicLike({ ...offer, status: "active" })) { reject("public_quality"); continue; }
  offer.status = "active";
  incoming.set(offer.id, offer);
}

const modelYearCounts = new Map();
const selectedGeorgia = [];
for (const offer of [...incoming.values()].sort(quality)) {
  const key = catalogModelYearQuotaKey(offer, "georgia");
  if (!key || Number(modelYearCounts.get(key) || 0) >= maxPerModelYear) { reject("model_year_quota"); continue; }
  modelYearCounts.set(key, Number(modelYearCounts.get(key) || 0) + 1);
  selectedGeorgia.push(offer);
  if (selectedGeorgia.length >= maxGeorgia) break;
}
if (selectedGeorgia.length < minGeorgia) throw new Error(`georgia_replace_below_min:${selectedGeorgia.length}:${minGeorgia}`);

const beforePublicRows = Object.fromEntries(await Promise.all(PUBLIC_CATALOG_MARKETS.map(async (market) => [market, await readMarketOffers(market)])));
const beforeCounts = Object.fromEntries(PUBLIC_CATALOG_MARKETS.map((market) => [market, beforePublicRows[market].length]));
const maintenance = await readAllOffersForMaintenance();

const preserved = maintenance.filter((offer) => {
  const market = String(offer?.market || "");
  if (!PUBLIC_CATALOG_MARKETS.includes(market) || market === "georgia") return false;
  return isCatalogYearAllowed(offer?.year, market);
});

const full = [...preserved, ...selectedGeorgia];
const ids = new Map();
for (const offer of full) {
  if (!offer?.id) throw new Error("full_array_missing_id");
  const previous = ids.get(offer.id);
  if (previous && previous !== offer.market) throw new Error(`cross_market_id_collision:${offer.id}:${previous}:${offer.market}`);
  ids.set(offer.id, offer.market);
}

// persistCatalogOffers enriches every offer with vehicle knowledge before the
// public gate. Project through that same enrichment before any write so a dry
// run cannot claim exact preservation and then lose another market at persist.
const projectedFull = await Promise.all(full.map(async (offer) =>
  normalizeVehicleOfferSpecs(await enrichOfferWithKnowledgeCore(offer))));
const projectedPublicCounts = Object.fromEntries(PUBLIC_CATALOG_MARKETS.map((market) => [
  market,
  projectedFull.filter((offer) => offer.market === market && publicLike(offer)).length,
]));
for (const market of PUBLIC_CATALOG_MARKETS) {
  if (market === "georgia") continue;
  if (projectedPublicCounts[market] !== beforeCounts[market]) {
    throw new Error(`preservation_projection_mismatch:${market}:${beforeCounts[market]}:${projectedPublicCounts[market]}`);
  }
}
if (projectedPublicCounts.georgia !== selectedGeorgia.length) throw new Error("georgia_projection_mismatch");

const reportBase = {
  version: 2,
  mode: "full-seven-market-georgia-replacement",
  dryRun,
  beforeCounts,
  projectedPublicCounts,
  maintenanceCount: maintenance.length,
  preservedInternalCount: preserved.length,
  georgia: {
    inputCount: Array.isArray(payload?.offers) ? payload.offers.length : 0,
    acceptedBeforeModelYearCap: incoming.size,
    selectedCount: selectedGeorgia.length,
    calculatedCount: selectedGeorgia.filter(exactCalculation).length,
    preliminaryCount: selectedGeorgia.filter(isPreliminaryPowerPendingCalculation).length,
    maxPerModelYear,
    sourceCounts: Object.fromEntries([...canonicalGeorgiaSources].map((sourceId) => [sourceId, selectedGeorgia.filter((offer) => offer.sourceId === sourceId).length])),
    minYear: Math.min(...selectedGeorgia.map((offer) => Number(offer.year || 0))),
    belowFiveImages: selectedGeorgia.filter((offer) => (offer.images?.length || 0) < 5).length,
    rejected,
  },
};

if (dryRun) {
  const report = { ...reportBase, published: false };
  await fs.writeFile(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

process.env.CATALOG_GROW_ONLY_MARKETS = "";
const manifest = await persistCatalogOffers(projectedFull);
const manifestCounts = Object.fromEntries(PUBLIC_CATALOG_MARKETS.map((market) => [market, Number(manifest?.markets?.[market]?.count || 0)]));
for (const market of PUBLIC_CATALOG_MARKETS) {
  if (manifestCounts[market] !== projectedPublicCounts[market]) {
    throw new Error(`postpersist_manifest_mismatch:${market}:${projectedPublicCounts[market]}:${manifestCounts[market]}`);
  }
}
const report = { ...reportBase, published: true, generationId: manifest.generationId, manifestCounts };
await fs.writeFile(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
