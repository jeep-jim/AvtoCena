import fs from "node:fs/promises";

const { persistCatalogOffers, readAllOffersForMaintenance, readMarketOffers } = await import("../apps/web/lib/catalog/storage.ts");
const { calculateOfferWithPreliminaryPowerPricing, isPreliminaryPowerPendingCalculation } = await import("../apps/web/lib/catalog/customs-pricing.ts");
const { hasCredibleOfferContent, isCatalogMarketSourceAllowed, isCatalogYearAllowed, credibleCatalogImages } = await import("../apps/web/lib/catalog/offer-quality.ts");
const { normalizeVehicleOfferSpecs } = await import("../apps/web/lib/catalog/spec-normalization.ts");
const { PUBLIC_CATALOG_MARKETS } = await import("../apps/web/lib/catalog/runtime-config.ts");

const mapPath = String(process.env.GEORGIA_POWER_MAP || "georgia-power-map.json");
const outputPath = String(process.env.GEORGIA_POWER_REPORT || "georgia-exact-power-maintenance-report.json");
const dryRun = /^(1|true|yes)$/i.test(String(process.env.GEORGIA_POWER_DRY_RUN ?? "1"));
const canonicalGeorgiaSources = new Set(["myauto_georgia_list", "myauto_georgia_exact", "autopapa_georgia_open"]);

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

function exactAutoPapaUrl(offer) {
  const id = String(offer?.sourceOfferId || "");
  const sourceUrl = String(offer?.operational?.sourceUrl || "");
  if (!/^\d{5,}$/.test(id) || !sourceUrl) return false;
  try {
    const url = new URL(sourceUrl);
    return url.protocol === "https:" && url.hostname === "autopapa.ge" && new RegExp(`/${id}/?$`).test(url.pathname);
  } catch { return false; }
}

function publicEligible(offer) {
  return offer?.status === "active" && hasCredibleOfferContent(offer);
}

function marketCounts(rows) {
  return Object.fromEntries(PUBLIC_CATALOG_MARKETS.map((market) => [market, rows.filter((offer) => offer.market === market && publicEligible(offer)).length]));
}

function sourceCounts(rows) {
  return Object.fromEntries([...new Set(rows.map((offer) => String(offer.sourceId || "unknown")))].sort()
    .map((sourceId) => [sourceId, rows.filter((offer) => String(offer.sourceId || "unknown") === sourceId).length]));
}

function modelKey(offer) {
  const make = String(offer?.make || "").trim().toLocaleLowerCase("en-US").replace(/\s+/g, " ");
  const model = String(offer?.model || "").trim().toLocaleLowerCase("en-US").replace(/\s+/g, " ");
  return make && model ? `${make}|${model}` : "";
}

function maxPerExactModel(rows) {
  const counts = new Map();
  for (const offer of rows) {
    const key = modelKey(offer);
    if (key) counts.set(key, Number(counts.get(key) || 0) + 1);
  }
  return Math.max(0, ...counts.values());
}

function invalidGeorgiaHost(offer) {
  try {
    const host = new URL(String(offer?.operational?.sourceUrl || "")).hostname.toLowerCase();
    return !(host === "autopapa.ge" || host.endsWith(".autopapa.ge") || host === "myauto.ge" || host.endsWith(".myauto.ge"));
  } catch { return true; }
}

const payload = JSON.parse(await fs.readFile(mapPath, "utf8"));
const mappingRows = Array.isArray(payload?.results) ? payload.results : Array.isArray(payload) ? payload : [];
const powerBySourceOfferId = new Map();
for (const row of mappingRows) {
  const sourceOfferId = String(row?.sourceOfferId || "");
  const powerHp = Number(row?.detailPowerHp || row?.powerHp || 0);
  if (!/^\d{5,}$/.test(sourceOfferId) || !(powerHp > 0 && powerHp <= 2500)) continue;
  const current = powerBySourceOfferId.get(sourceOfferId);
  if (current && Math.abs(Number(current.powerHp) - powerHp) > 0.01) throw new Error(`power_map_conflict:${sourceOfferId}:${current.powerHp}:${powerHp}`);
  powerBySourceOfferId.set(sourceOfferId, { powerHp, id: String(row?.id || "") });
}

const publicBeforeEntries = await Promise.all(PUBLIC_CATALOG_MARKETS.map(async (market) => [market, await readMarketOffers(market)]));
const publicBefore = Object.fromEntries(publicBeforeEntries);
const beforeCounts = Object.fromEntries(PUBLIC_CATALOG_MARKETS.map((market) => [market, publicBefore[market].length]));
const allInternal = await readAllOffersForMaintenance();
const georgiaBefore = publicBefore.georgia;
if (!georgiaBefore.length) throw new Error("georgia_public_empty");

const preliminaryBefore = georgiaBefore.filter(isPreliminaryPowerPendingCalculation).length;
const candidates = georgiaBefore.filter((offer) => offer.sourceId === "autopapa_georgia_open"
  && String(offer.powertrainKind || "") === "combustion"
  && !(Number(offer.powerHp || 0) > 0)
  && exactAutoPapaUrl(offer));

let mappedCandidates = 0;
let changedToCalculated = 0;
let sourceExactButNotCalculated = 0;
const changedSamples = [];
const unchangedReasons = {};
const reject = (reason) => { unchangedReasons[reason] = Number(unchangedReasons[reason] || 0) + 1; };

const georgiaAfter = [];
for (const original of georgiaBefore) {
  if (!(original.sourceId === "autopapa_georgia_open"
    && String(original.powertrainKind || "") === "combustion"
    && !(Number(original.powerHp || 0) > 0)
    && exactAutoPapaUrl(original))) {
    georgiaAfter.push(original);
    continue;
  }

  const mapped = powerBySourceOfferId.get(String(original.sourceOfferId || ""));
  if (!mapped) {
    reject("no_exact_detail_power");
    georgiaAfter.push(original);
    continue;
  }
  if (mapped.id && mapped.id !== String(original.id || "")) {
    reject("offer_identity_mismatch");
    georgiaAfter.push(original);
    continue;
  }
  mappedCandidates += 1;

  const powerHp = Number(mapped.powerHp);
  const withSourcePower = normalizeVehicleOfferSpecs({
    ...original,
    powerHp,
    powerKw: Math.round((powerHp / 1.359621617) * 10) / 10,
    powerDataConfidence: "source_exact",
    powerDataSource: `autopapa-detail:${original.sourceOfferId}:Power`,
    operational: {
      ...original.operational,
      raw: {
        ...(original.operational?.raw && typeof original.operational.raw === "object" ? original.operational.raw : {}),
        autoPapaDetailPowerHp: powerHp,
        exactPowerMaintenance: true,
      },
    },
  });

  const recalculated = normalizeVehicleOfferSpecs(await calculateOfferWithPreliminaryPowerPricing(withSourcePower));
  if (!exactCalculation(recalculated)) {
    sourceExactButNotCalculated += 1;
    reject("source_power_not_full_calculation");
    georgiaAfter.push(original);
    continue;
  }

  changedToCalculated += 1;
  if (changedSamples.length < 30) changedSamples.push({
    sourceOfferId: original.sourceOfferId,
    make: original.make,
    model: original.model,
    year: original.year,
    engineCc: original.engineCc,
    powerHp,
    beforeTotalRub: original.totalRub,
    afterTotalRub: recalculated.totalRub,
    beforeStatus: original.calculationStatus,
    afterStatus: recalculated.calculationStatus,
  });
  georgiaAfter.push(recalculated);
}

if (georgiaAfter.length !== georgiaBefore.length) throw new Error(`georgia_count_changed_in_memory:${georgiaBefore.length}:${georgiaAfter.length}`);

const combined = [...allInternal.filter((offer) => offer.market !== "georgia"), ...georgiaAfter];
const unique = new Map();
for (const offer of combined) {
  if (!offer?.id) continue;
  if (unique.has(offer.id)) throw new Error(`duplicate_offer_id:${offer.id}`);
  unique.set(offer.id, offer);
}
const nextAll = [...unique.values()];
const projectedCounts = marketCounts(nextAll);

for (const market of PUBLIC_CATALOG_MARKETS) {
  if (Number(projectedCounts[market] || 0) !== Number(beforeCounts[market] || 0)) {
    throw new Error(`projected_public_count_mismatch:${market}:${beforeCounts[market]}:${projectedCounts[market]}`);
  }
}

const projectedPublic = nextAll.filter(publicEligible);
for (const offer of projectedPublic) {
  if (!isCatalogYearAllowed(offer.year, offer.market)) throw new Error(`age_gate:${offer.market}:${offer.id}:${offer.year}`);
  if (!isCatalogMarketSourceAllowed(offer)) throw new Error(`source_gate:${offer.market}:${offer.sourceId}:${offer.id}`);
}

const projectedGeorgia = georgiaAfter.filter(publicEligible);
if (projectedGeorgia.some((offer) => !canonicalGeorgiaSources.has(String(offer.sourceId || "")))) throw new Error("georgia_noncanonical_source");
if (projectedGeorgia.some(invalidGeorgiaHost)) throw new Error("georgia_noncanonical_host");
if (projectedGeorgia.some((offer) => credibleCatalogImages(offer.images || []).length < 5)) throw new Error("georgia_gallery_below_five");
if (maxPerExactModel(projectedGeorgia) > 20) throw new Error(`georgia_model_cap:${maxPerExactModel(projectedGeorgia)}`);

const preliminaryAfter = projectedGeorgia.filter(isPreliminaryPowerPendingCalculation).length;
const calculatedAfter = projectedGeorgia.filter(exactCalculation).length;
const report = {
  version: 1,
  mode: dryRun ? "georgia_exact_source_power_dry_run" : "georgia_exact_source_power_publish",
  dryRun,
  published: false,
  beforeCounts,
  projectedCounts,
  internalCount: allInternal.length,
  georgiaCount: georgiaBefore.length,
  georgiaSourceCounts: sourceCounts(projectedGeorgia),
  candidateMissingCombustionPower: candidates.length,
  mappingRows: mappingRows.length,
  mappedExactPowerCandidates: mappedCandidates,
  changedToCalculated,
  sourceExactButNotCalculated,
  preliminaryBefore,
  preliminaryAfter,
  preliminaryReducedBy: preliminaryBefore - preliminaryAfter,
  calculatedAfter,
  maxPerExactModel: maxPerExactModel(projectedGeorgia),
  changedSamples,
  unchangedReasons,
};

if (dryRun) {
  await fs.writeFile(outputPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

if (changedToCalculated <= 0 || preliminaryAfter >= preliminaryBefore) throw new Error("no_meaningful_exact_power_improvement");

process.env.CATALOG_GROW_ONLY_MARKETS = "";
const manifest = await persistCatalogOffers(nextAll);
const afterEntries = await Promise.all(PUBLIC_CATALOG_MARKETS.map(async (market) => [market, await readMarketOffers(market)]));
const publicAfter = Object.fromEntries(afterEntries);
const afterCounts = Object.fromEntries(PUBLIC_CATALOG_MARKETS.map((market) => [market, publicAfter[market].length]));
for (const market of PUBLIC_CATALOG_MARKETS) {
  if (Number(afterCounts[market] || 0) !== Number(beforeCounts[market] || 0)) throw new Error(`postwrite_count_mismatch:${market}:${beforeCounts[market]}:${afterCounts[market]}`);
}

const liveGeorgia = publicAfter.georgia;
if (liveGeorgia.some((offer) => !isCatalogYearAllowed(offer.year, "georgia"))) throw new Error("postwrite_georgia_age");
if (liveGeorgia.some((offer) => !canonicalGeorgiaSources.has(String(offer.sourceId || "")) || invalidGeorgiaHost(offer))) throw new Error("postwrite_georgia_source");
if (liveGeorgia.some((offer) => credibleCatalogImages(offer.images || []).length < 5)) throw new Error("postwrite_georgia_gallery");
if (maxPerExactModel(liveGeorgia) > 20) throw new Error(`postwrite_georgia_model_cap:${maxPerExactModel(liveGeorgia)}`);

Object.assign(report, {
  published: true,
  generationId: manifest.generationId,
  afterCounts,
  livePreliminaryAfter: liveGeorgia.filter(isPreliminaryPowerPendingCalculation).length,
  liveCalculatedAfter: liveGeorgia.filter(exactCalculation).length,
});
await fs.writeFile(outputPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
