import fs from "node:fs/promises";

const { readCurrentPublicCatalogProjection } = await import("../apps/web/lib/catalog/storage.ts");
const { hasCredibleCatalogIdentity } = await import("../apps/web/lib/catalog/offer-quality.ts");
const { catalogOfferVisibleRub, catalogRequiredSpecificationRejectionReason } = await import("../apps/web/lib/catalog/public-priority.ts");

const OUTPUT = process.env.CATALOG_VISIBLE_CALCULATION_AUDIT_OUTPUT || "catalog-visible-calculation-coverage.json";
const SAMPLE_LIMIT = Math.max(20, Math.min(500, Number(process.env.CATALOG_VISIBLE_CALCULATION_SAMPLE_LIMIT || 200)));

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

function exactPowerState(offer, requireExactProvenance = false) {
  const scenario = offer?.calculationSnapshot?.powerScenario;
  const scenarioSource = clean(offer?.powerDataSource);
  if (scenario?.requiresConfirmation === true || /^power_scenario:/i.test(scenarioSource)) return {
    exactEnoughForReady: false,
    reasons: ["unconfirmed_power_scenario"],
    powerDataConfidence: "estimated",
    powerDataSource: scenarioSource || `power_scenario:${scenario?.source || "unknown"}`,
    totalThirtyMinuteKw: null,
  };
  const attestedProjection = Number(offer?.cardProjectionVersion || 0) >= 3
    && offer?.publicSpecificationVerified === true
    && positive(offer?.publicVisibleRub);
  if (attestedProjection) return {
    exactEnoughForReady: true,
    reasons: [],
    powerDataConfidence: clean(offer?.powerDataConfidence).toLowerCase() || null,
    powerDataSource: clean(offer?.powerDataSource) || "server_attested_public_projection_v3",
    totalThirtyMinuteKw: totalThirtyMinuteKw(offer) || null,
  };
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

  if (requireExactProvenance && definitelyNonExact) reasons.push("non_exact_power_source");

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

function increment(map, key, amount = 1) {
  map.set(key, Number(map.get(key) || 0) + amount);
}

function sortedCounts(map, limit = SAMPLE_LIMIT) {
  return [...map.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key, "ru"))
    .slice(0, limit);
}

const publicReadmodel = await readCurrentPublicCatalogProjection();
const visible = publicReadmodel.rows || [];

const byMarket = new Map();
const needsDataModels = new Map();
const unresolvedModels = new Map();
const invalidReady = [];
const readyUnclassified = [];
const invalidSpecifications = [];
const unsafePendingVisiblePrices = [];
const unpricedPublicCards = [];
const fallbackPowerCards = [];
const unprovenExact100Cards = [];
const statusCounts = new Map();
const visibleModels = new Set();
let readyExact = 0;
let ready = 0;
let needsData = 0;
let preliminary = 0;
let auctionStart = 0;
let resolvedIdentity = 0;

for (const offer of visible) {
  const market = clean(offer.market) || "unknown";
  const status = clean(offer.calculationStatus) || "unknown";
  const pair = `${clean(offer.make)} ${clean(offer.model)}`.trim();
  const pairKey = `${clean(offer?.make)}\u0000${clean(offer?.model)}`;
  visibleModels.add(pairKey);
  increment(statusCounts, status);
  const specificationRejection = catalogRequiredSpecificationRejectionReason(offer);
  if (specificationRejection) invalidSpecifications.push({ id: offer.id, market, make: offer.make, model: offer.model, reason: specificationRejection });
  if (specificationRejection === "unconfirmed_power_scenario") fallbackPowerCards.push({ id: offer.id, market, make: offer.make, model: offer.model, powerDataSource: offer.powerDataSource || null });
  if (specificationRejection === "unproven_exact_100_hp") unprovenExact100Cards.push({ id: offer.id, market, make: offer.make, model: offer.model });

  const marketRow = byMarket.get(market) || { visible: 0, ready: 0, readyExact: 0, needsData: 0, preliminary: 0, auctionStart: 0, unresolvedIdentity: 0, invalidReady: 0, unsafePendingVisiblePrice: 0, unpricedPublic: 0 };
  marketRow.visible++;

  const identityResolved = hasCredibleCatalogIdentity(offer);
  if (identityResolved) resolvedIdentity++;
  else {
    marketRow.unresolvedIdentity++;
    increment(unresolvedModels, `${market} · ${pair}`);
  }

  if (status === "ready" || status === "estimated") {
    ready++;
    marketRow.ready++;
    const exact = exactPowerState(offer, status === "ready");
    const totalRub = positive(offer.totalRub);
    const hardReasons = [...exact.reasons];
    if (!identityResolved) hardReasons.push("unresolved_model_identity");
    if (!totalRub) hardReasons.push("missing_total_rub");
    if (hardReasons.length) {
      const visibleRub = catalogOfferVisibleRub(offer);
      const safelyHiddenEstimated = status === "estimated" && visibleRub === 0 && identityResolved;
      if (safelyHiddenEstimated) {
        increment(needsDataModels, `${market} · ${pair} · ${[...new Set(hardReasons)].join(",")}`);
      } else {
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
      }
    } else if (status === "ready") {
      readyExact++;
      marketRow.readyExact++;
      if (!clean(offer.powerDataConfidence)) {
        readyUnclassified.push({ id: offer.id, market, make: offer.make, model: offer.model, year: offer.year });
      }
    }
  } else if (status === "needs_data" || status === "needs_power_data" || status === "preliminary_power_pending") {
    needsData++;
    marketRow.needsData++;
    if (status === "preliminary_power_pending") {
      preliminary++;
      marketRow.preliminary++;
    }
    const state = exactPowerState(offer);
    const reasons = [...state.reasons];
    if (!identityResolved) reasons.push("unresolved_model_identity");
    if (!reasons.length) reasons.push("calculation_dependencies_pending");
    increment(needsDataModels, `${market} · ${pair} · ${[...new Set(reasons)].join(",")}`);
  } else if (status === "auction_start") {
    auctionStart++;
    marketRow.auctionStart++;
  }

  // Pending/incomplete inventory is product-valid, but it must never masquerade
  // as a completed delivered-RUB calculation. The compact public projection
  // carries only an admitted public price, so any positive value here is a real
  // safety violation; missing specs by themselves are diagnostics, not a reason
  // to delete a real source-priced vehicle from the catalog.
  const pendingOrIncomplete = Boolean(specificationRejection)
    || ["needs_data", "needs_power_data", "preliminary_power_pending"].includes(status);
  const visibleRub = catalogOfferVisibleRub(offer);
  if (visibleRub <= 0) {
    marketRow.unpricedPublic++;
    unpricedPublicCards.push({
      id: offer.id,
      market,
      make: offer.make,
      model: offer.model,
      calculationStatus: status,
      specificationRejection: specificationRejection || null,
    });
  }
  if (pendingOrIncomplete && visibleRub > 0) {
    marketRow.unsafePendingVisiblePrice++;
    unsafePendingVisiblePrices.push({
      id: offer.id,
      market,
      make: offer.make,
      model: offer.model,
      calculationStatus: status,
      specificationRejection: specificationRejection || null,
      visibleRub,
    });
  }

  byMarket.set(market, marketRow);
}

const allIdentitiesResolved = resolvedIdentity === visible.length;
const report = {
  version: 2,
  auditedAt: new Date().toISOString(),
  mode: "production_visible_read_only",
  totals: {
    publicReadmodelOffers: visible.length,
    generationId: publicReadmodel.generationId,
    visibleOffers: visible.length,
    visibleMakeModelPairs: visibleModels.size,
    resolvedIdentity,
    identityResolutionRatio: visible.length ? Number((resolvedIdentity / visible.length).toFixed(5)) : 0,
    ready,
    readyExact,
    readyExactRatio: ready ? Number((readyExact / ready).toFixed(5)) : 1,
    needsData,
    preliminary,
    auctionStart,
    invalidReady: invalidReady.length,
    invalidSpecifications: invalidSpecifications.length,
    unsafePendingVisiblePrices: unsafePendingVisiblePrices.length,
    unpricedPublicCards: unpricedPublicCards.length,
    fallback100PublicCount: fallbackPowerCards.length,
    unprovenExact100PublicCount: unprovenExact100Cards.length,
    readyWithoutConfidenceLabel: readyUnclassified.length,
  },
  statusCounts: Object.fromEntries([...statusCounts.entries()].sort((a, b) => b[1] - a[1])),
  byMarket: Object.fromEntries([...byMarket.entries()].sort((a, b) => a[0].localeCompare(b[0]))),
  invalidReady: invalidReady.slice(0, SAMPLE_LIMIT),
  invalidSpecifications: invalidSpecifications.slice(0, SAMPLE_LIMIT),
  unsafePendingVisiblePrices: unsafePendingVisiblePrices.slice(0, SAMPLE_LIMIT),
  unpricedPublicCards: unpricedPublicCards.slice(0, SAMPLE_LIMIT),
  fallbackPowerCards: fallbackPowerCards.slice(0, SAMPLE_LIMIT),
  unprovenExact100Cards: unprovenExact100Cards.slice(0, SAMPLE_LIMIT),
  unresolvedModels: sortedCounts(unresolvedModels),
  needsDataQueue: sortedCounts(needsDataModels),
  readyWithoutConfidenceLabel: readyUnclassified.slice(0, SAMPLE_LIMIT),
  releaseGate: {
    noInvalidReady: invalidReady.length === 0,
    allIdentitiesResolved,
    noUnsafePendingVisiblePrices: unsafePendingVisiblePrices.length === 0,
    noUnpricedPublicCards: unpricedPublicCards.length === 0,
    noInvalidSpecifications: invalidSpecifications.length === 0,
    noFallback100PublicCards: fallbackPowerCards.length === 0,
    noUnprovenExact100PublicCards: unprovenExact100Cards.length === 0,
    noPreliminaryPublicPrices: preliminary === 0,
    noNeedsDataPublicCards: needsData === 0,
    pass: invalidReady.length === 0
      && allIdentitiesResolved
      && unsafePendingVisiblePrices.length === 0
      && unpricedPublicCards.length === 0
      && invalidSpecifications.length === 0
      && fallbackPowerCards.length === 0
      && unprovenExact100Cards.length === 0
      && preliminary === 0
      && needsData === 0,
  },
};

await fs.writeFile(OUTPUT, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));

if (process.env.GITHUB_OUTPUT) {
  await fs.appendFile(process.env.GITHUB_OUTPUT, `visible_offers=${report.totals.visibleOffers}\n`);
  await fs.appendFile(process.env.GITHUB_OUTPUT, `visible_models=${report.totals.visibleMakeModelPairs}\n`);
  await fs.appendFile(process.env.GITHUB_OUTPUT, `ready_exact=${report.totals.readyExact}\n`);
  await fs.appendFile(process.env.GITHUB_OUTPUT, `needs_data=${report.totals.needsData}\n`);
  await fs.appendFile(process.env.GITHUB_OUTPUT, `preliminary=${report.totals.preliminary}\n`);
  await fs.appendFile(process.env.GITHUB_OUTPUT, `invalid_ready=${report.totals.invalidReady}\n`);
  await fs.appendFile(process.env.GITHUB_OUTPUT, `invalid_specifications=${report.totals.invalidSpecifications}\n`);
  await fs.appendFile(process.env.GITHUB_OUTPUT, `unsafe_pending_visible_prices=${report.totals.unsafePendingVisiblePrices}\n`);
  await fs.appendFile(process.env.GITHUB_OUTPUT, `unpriced_public_cards=${report.totals.unpricedPublicCards}\n`);
  await fs.appendFile(process.env.GITHUB_OUTPUT, `fallback_100_public=${report.totals.fallback100PublicCount}\n`);
  await fs.appendFile(process.env.GITHUB_OUTPUT, `unproven_exact_100_public=${report.totals.unprovenExact100PublicCount}\n`);
}

if (!report.releaseGate.pass) process.exitCode = 1;
