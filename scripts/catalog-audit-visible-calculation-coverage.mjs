import fs from "node:fs/promises";

const { readAllOffersForMaintenance } = await import("../apps/web/lib/catalog/storage.ts");
const { isCrediblePublicOffer, hasCredibleCatalogIdentity } = await import("../apps/web/lib/catalog/offer-quality.ts");
const { findVehicleModel } = await import("../apps/web/lib/catalog/vehicle-knowledge.ts");

const OUTPUT = process.env.CATALOG_VISIBLE_CALCULATION_AUDIT_OUTPUT || "catalog-visible-calculation-coverage.json";
const SAMPLE_LIMIT = Math.max(20, Math.min(500, Number(process.env.CATALOG_VISIBLE_CALCULATION_SAMPLE_LIMIT || 200)));
const MAX_MATCH_CONCURRENCY = Math.max(1, Math.min(32, Number(process.env.CATALOG_VISIBLE_CALCULATION_MATCH_CONCURRENCY || 12)));

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function positive(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}

function totalThirtyMinuteKw(offer) {
  const direct = positive(offer?.power30MinKw);
  if (direct) return direct;
  const motors = Array.isArray(offer?.power30MinKwByMotor)
    ? offer.power30MinKwByMotor.map(positive).filter(Boolean)
    : [];
  return motors.length ? motors.reduce((sum, value) => sum + value, 0) : undefined;
}

function modelKey(offer) {
  return `${clean(offer?.make)}\u0000${clean(offer?.model)}`;
}

function matchKey(offer) {
  return [clean(offer?.make), clean(offer?.model), Number(offer?.year || 0), Number(offer?.engineCc || 0), clean(offer?.fuel), clean(offer?.powertrainKind)].join("\u0000");
}

function exactPowerState(offer) {
  const kind = clean(offer?.powertrainKind).toLowerCase();
  const engineCc = positive(offer?.engineCc);
  const powerHp = positive(offer?.powerHp);
  const powerKw = positive(offer?.powerKw);
  const icePowerKw = positive(offer?.icePowerKw);
  const thirty = totalThirtyMinuteKw(offer);
  const confidence = clean(offer?.powerDataConfidence).toLowerCase();
  const source = clean(offer?.powerDataSource);
  const definitelyNonExact = confidence === "estimated" || /^vehicle-model-representative:/i.test(source);
  const reasons = [];

  if (definitelyNonExact) reasons.push("non_exact_power_source");

  if (kind === "electric") {
    if (!powerKw && !powerHp) reasons.push("missing_peak_power");
    if (!thirty) reasons.push("missing_certified_30min_kw");
  } else if (kind === "series_hybrid") {
    if (!engineCc) reasons.push("missing_engine_cc");
    if (!thirty) reasons.push("missing_certified_30min_kw");
  } else if (kind === "other_hybrid") {
    if (!engineCc) reasons.push("missing_engine_cc");
    if (!icePowerKw) reasons.push("missing_ice_power_kw");
    if (!thirty) reasons.push("missing_certified_30min_kw");
  } else {
    if (!engineCc) reasons.push("missing_engine_cc");
    if (!powerHp) reasons.push("missing_power_hp");
  }

  return {
    exactEnoughForReady: reasons.length === 0,
    reasons,
    powerDataConfidence: confidence || null,
    powerDataSource: source || null,
    totalThirtyMinuteKw: thirty || null,
  };
}

async function mapWithConcurrency(items, concurrency, worker) {
  const output = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, items.length)) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      output[index] = await worker(items[index], index);
    }
  }));
  return output;
}

function increment(map, key, amount = 1) {
  map.set(key, Number(map.get(key) || 0) + amount);
}

function sortedCounts(map, limit = SAMPLE_LIMIT) {
  return [...map.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key, "ru"))
    .slice(0, limit);
}

const offers = await readAllOffersForMaintenance();
const visible = offers.filter((offer) => isCrediblePublicOffer(offer));
const representativeByMatch = new Map();
for (const offer of visible) {
  const key = matchKey(offer);
  if (!representativeByMatch.has(key)) representativeByMatch.set(key, offer);
}

const matchEntries = [...representativeByMatch.entries()];
const matchResults = await mapWithConcurrency(matchEntries, MAX_MATCH_CONCURRENCY, async ([key, offer]) => {
  try {
    const match = await findVehicleModel(offer);
    return [key, match?.model?.id || null];
  } catch (error) {
    return [key, null, String(error?.message || error)];
  }
});
const resolvedByMatch = new Map(matchResults.map(([key, modelId]) => [key, modelId]));

const byMarket = new Map();
const needsDataModels = new Map();
const unresolvedModels = new Map();
const invalidReady = [];
const readyUnclassified = [];
const statusCounts = new Map();
const visibleModels = new Set();
let readyExact = 0;
let ready = 0;
let needsData = 0;
let auctionStart = 0;
let resolvedIdentity = 0;

for (const offer of visible) {
  const market = clean(offer.market) || "unknown";
  const status = clean(offer.calculationStatus) || "unknown";
  const pair = `${clean(offer.make)} ${clean(offer.model)}`.trim();
  const pairKey = modelKey(offer);
  visibleModels.add(pairKey);
  increment(statusCounts, status);

  const marketRow = byMarket.get(market) || { visible: 0, ready: 0, readyExact: 0, needsData: 0, auctionStart: 0, unresolvedIdentity: 0, invalidReady: 0 };
  marketRow.visible++;

  const identityResolved = hasCredibleCatalogIdentity(offer) && Boolean(resolvedByMatch.get(matchKey(offer)));
  if (identityResolved) resolvedIdentity++;
  else {
    marketRow.unresolvedIdentity++;
    increment(unresolvedModels, `${market} · ${pair}`);
  }

  if (status === "ready") {
    ready++;
    marketRow.ready++;
    const exact = exactPowerState(offer);
    const totalRub = positive(offer.totalRub);
    const hardReasons = [...exact.reasons];
    if (!identityResolved) hardReasons.push("unresolved_model_identity");
    if (!totalRub) hardReasons.push("missing_total_rub");
    if (hardReasons.length) {
      marketRow.invalidReady++;
      invalidReady.push({
        id: offer.id,
        market,
        make: offer.make,
        model: offer.model,
        trim: offer.trim || null,
        year: offer.year,
        calculationStatus: status,
        reasons: hardReasons,
        powerDataConfidence: exact.powerDataConfidence,
        powerDataSource: exact.powerDataSource,
      });
    } else {
      readyExact++;
      marketRow.readyExact++;
      if (!clean(offer.powerDataConfidence)) {
        readyUnclassified.push({ id: offer.id, market, make: offer.make, model: offer.model, year: offer.year });
      }
    }
  } else if (status === "needs_data") {
    needsData++;
    marketRow.needsData++;
    const state = exactPowerState(offer);
    const reasons = [...state.reasons];
    if (!identityResolved) reasons.push("unresolved_model_identity");
    if (!reasons.length) reasons.push("calculation_dependencies_pending");
    increment(needsDataModels, `${market} · ${pair} · ${[...new Set(reasons)].join(",")}`);
  } else if (status === "auction_start") {
    auctionStart++;
    marketRow.auctionStart++;
  }

  byMarket.set(market, marketRow);
}

const report = {
  version: 1,
  auditedAt: new Date().toISOString(),
  mode: "production_visible_read_only",
  totals: {
    maintenanceOffers: offers.length,
    visibleOffers: visible.length,
    visibleMakeModelPairs: visibleModels.size,
    resolvedIdentity,
    identityResolutionRatio: visible.length ? Number((resolvedIdentity / visible.length).toFixed(5)) : 0,
    ready,
    readyExact,
    readyExactRatio: ready ? Number((readyExact / ready).toFixed(5)) : 1,
    needsData,
    auctionStart,
    invalidReady: invalidReady.length,
    readyWithoutConfidenceLabel: readyUnclassified.length,
  },
  statusCounts: Object.fromEntries([...statusCounts.entries()].sort((a, b) => b[1] - a[1])),
  byMarket: Object.fromEntries([...byMarket.entries()].sort((a, b) => a[0].localeCompare(b[0]))),
  invalidReady: invalidReady.slice(0, SAMPLE_LIMIT),
  unresolvedModels: sortedCounts(unresolvedModels),
  needsDataQueue: sortedCounts(needsDataModels),
  readyWithoutConfidenceLabel: readyUnclassified.slice(0, SAMPLE_LIMIT),
  releaseGate: {
    noInvalidReady: invalidReady.length === 0,
    pass: invalidReady.length === 0,
  },
};

await fs.writeFile(OUTPUT, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));

if (process.env.GITHUB_OUTPUT) {
  await fs.appendFile(process.env.GITHUB_OUTPUT, `visible_offers=${report.totals.visibleOffers}\n`);
  await fs.appendFile(process.env.GITHUB_OUTPUT, `visible_models=${report.totals.visibleMakeModelPairs}\n`);
  await fs.appendFile(process.env.GITHUB_OUTPUT, `ready_exact=${report.totals.readyExact}\n`);
  await fs.appendFile(process.env.GITHUB_OUTPUT, `needs_data=${report.totals.needsData}\n`);
  await fs.appendFile(process.env.GITHUB_OUTPUT, `invalid_ready=${report.totals.invalidReady}\n`);
}

if (!report.releaseGate.pass) process.exitCode = 1;
