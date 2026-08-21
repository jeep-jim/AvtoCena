import fs from "node:fs/promises";

const { readCurrentPublicCatalogProjection } = await import("../apps/web/lib/catalog/storage.ts");
const {
  calculateOfferWithPreliminaryPowerPricing,
  calculateOfferWithRussiaCustoms,
  isPreliminaryPowerPendingCalculation,
} = await import("../apps/web/lib/catalog/customs-pricing.ts");
const { refreshLiveExchangeRates } = await import("../apps/web/lib/catalog/live-rates.ts");
const { resetCatalogRateCache } = await import("../apps/web/lib/catalog/rates.ts");

const OUTPUT = process.env.CATALOG_RF_CUSTOMS_LIVE_PROOF_OUTPUT || "catalog-rf-customs-live-card-proof.json";

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function positive(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function normalizedCategory(value) {
  const category = clean(value).toUpperCase();
  return category === "M1" || category === "N1" ? category : "";
}

function isElectrified(offer) {
  return ["electric", "series_hybrid", "other_hybrid"].includes(clean(offer?.powertrainKind));
}

function totalThirtyMinuteKw(offer) {
  const direct = positive(offer?.power30MinKw);
  if (direct) return direct;
  const byMotor = Array.isArray(offer?.power30MinKwByMotor)
    ? offer.power30MinKwByMotor.map(positive).filter(Boolean)
    : [];
  return byMotor.length ? byMotor.reduce((sum, value) => sum + value, 0) : 0;
}

function hasTrustedPower(offer) {
  const confidence = clean(offer?.powerDataConfidence).toLowerCase();
  const source = clean(offer?.powerDataSource).toLowerCase();
  return ["documented", "source_exact"].includes(confidence) && !source.includes("estimated");
}

const PICKUP_BODY_RE = /\b(?:pickup|pick-up|light\s*truck|truck|commercial)\b|пикап|груз/i;
const PICKUP_MODEL_RE = /\b(?:hilux|tacoma|tundra|ranger|amarok|colorado|gladiator|navara|frontier|d-?max|triton|l200|musso|rexton\s+sports|silverado|f-?150|ram\s*1500|poer|cannon)\b/i;

function isPickupLike(offer) {
  const body = clean(offer?.bodyType);
  const identity = `${clean(offer?.make)} ${clean(offer?.model)} ${clean(offer?.sourceTitle)}`;
  return PICKUP_BODY_RE.test(body) || PICKUP_MODEL_RE.test(identity);
}

function candidateLabel(offer) {
  return `${clean(offer.market)} · ${clean(offer.make)} ${clean(offer.model)} · ${offer.year || "?"} · ${clean(offer.id)}`;
}

function stableSort(rows, scorer) {
  return [...rows].sort((left, right) => {
    const score = scorer(right) - scorer(left);
    if (score) return score;
    return candidateLabel(left).localeCompare(candidateLabel(right), "en");
  });
}

function commonCandidate(offer) {
  return positive(offer?.sourcePrice) > 0
    && clean(offer?.sourceCurrency)
    && (positive(offer?.year) > 0 || clean(offer?.productionDate));
}

function chooseIce(rows) {
  const candidates = rows.filter((offer) => commonCandidate(offer)
    && !isElectrified(offer)
    && !isPickupLike(offer)
    && positive(offer?.engineCc) > 0
    && (positive(offer?.powerHp) > 0 || positive(offer?.powerKw) > 0));
  return stableSort(candidates, (offer) =>
    (hasTrustedPower(offer) ? 100 : 0)
    + (/sedan|hatch|wagon|coupe|suv|crossover|универсал|седан|хэтч/i.test(clean(offer?.bodyType)) ? 20 : 0)
    + (clean(offer?.productionDate) ? 10 : 0)
    + (["EUR", "AED", "KRW", "JPY", "CNY"].includes(clean(offer?.sourceCurrency).toUpperCase()) ? 5 : 0)
  )[0] || null;
}

function chooseElectrified(rows) {
  const candidates = rows.filter((offer) => commonCandidate(offer)
    && isElectrified(offer)
    && !isPickupLike(offer));
  return stableSort(candidates, (offer) =>
    (totalThirtyMinuteKw(offer) > 0 ? 100 : 0)
    + (hasTrustedPower(offer) ? 50 : 0)
    + (clean(offer?.powertrainKind) === "electric" ? 20 : 0)
    + (clean(offer?.productionDate) ? 10 : 0)
  )[0] || null;
}

function choosePickup(rows) {
  const candidates = rows.filter((offer) => commonCandidate(offer) && isPickupLike(offer));
  return stableSort(candidates, (offer) =>
    (positive(offer?.engineCc) > 0 && (positive(offer?.powerHp) > 0 || positive(offer?.powerKw) > 0) ? 200 : 0)
    + (normalizedCategory(offer?.vehicleCategory) ? 100 : 0)
    + (/^8704/.test(clean(offer?.tnVedCode).replace(/\D/g, "")) ? 80 : 0)
    + (PICKUP_BODY_RE.test(clean(offer?.bodyType)) ? 60 : 0)
    + (/hilux/i.test(`${clean(offer?.make)} ${clean(offer?.model)}`) ? 20 : 0)
    + (clean(offer?.productionDate) ? 10 : 0)
  )[0] || null;
}

async function calculate(offer) {
  return isPreliminaryPowerPendingCalculation(offer)
    ? calculateOfferWithPreliminaryPowerPricing(offer)
    : calculateOfferWithRussiaCustoms(offer);
}

function customsOf(offer) {
  return offer?.calculationSnapshot?.customs || {};
}

function snapshotOf(offer) {
  return offer?.calculationSnapshot || {};
}

function summarize(source, result) {
  const snapshot = snapshotOf(result);
  const customs = customsOf(result);
  return {
    id: source.id,
    market: source.market,
    make: source.make,
    model: source.model,
    year: source.year,
    productionDate: source.productionDate || null,
    bodyType: source.bodyType || null,
    vehicleCategory: source.vehicleCategory || null,
    tnVedCode: source.tnVedCode || null,
    powertrainKind: result.powertrainKind || source.powertrainKind || null,
    powerHp: result.powerHp || source.powerHp || null,
    powerKw: result.powerKw || source.powerKw || null,
    power30MinKw: result.power30MinKw || source.power30MinKw || null,
    power30MinKwByMotor: result.power30MinKwByMotor || source.power30MinKwByMotor || null,
    utilizationPowerKw: result.utilizationPowerKw || source.utilizationPowerKw || null,
    powerDataConfidence: result.powerDataConfidence || source.powerDataConfidence || null,
    powerDataSource: result.powerDataSource || source.powerDataSource || null,
    oldCalculationStatus: source.calculationStatus,
    oldTotalRub: source.totalRub ?? null,
    newCalculationStatus: result.calculationStatus,
    newTotalRub: result.totalRub ?? null,
    pricingConfidence: snapshot.pricingConfidence || null,
    priceIncludesUtilizationFee: snapshot.priceIncludesUtilizationFee ?? null,
    priceIncludesAllCustoms: snapshot.priceIncludesAllCustoms ?? null,
    sourcePriceRub: snapshot.sourcePriceRub ?? null,
    customsValueRub: snapshot.customsValue?.totalRub ?? null,
    transportToBorderRub: snapshot.customsValue?.transportToBorderRub ?? null,
    customs: {
      status: customs.status || null,
      ageBand: customs.ageBand || null,
      ageMonths: customs.ageMonths ?? null,
      productionReferenceDate: customs.productionReferenceDate || null,
      productionReferenceBasis: customs.productionReferenceBasis || null,
      vehicleCategory: customs.vehicleCategory || null,
      vehicleCategoryAssumed: customs.vehicleCategoryAssumed ?? null,
      personalUseAssumed: customs.personalUseAssumed ?? null,
      customsValueRub: customs.customsValueRub ?? null,
      importDutyRub: customs.importDutyRub ?? null,
      exciseRub: customs.exciseRub ?? null,
      vatRub: customs.vatRub ?? null,
      utilizationFeeRub: customs.utilizationFeeRub ?? null,
      totalCustomsRub: customs.totalCustomsRub ?? null,
      knownCustomsRub: customs.knownCustomsRub ?? null,
      missing: customs.missing || [],
    },
  };
}

function assertProof(condition, failures, message) {
  if (!condition) failures.push(message);
}

await refreshLiveExchangeRates();
resetCatalogRateCache();

const projection = await readCurrentPublicCatalogProjection();
const rows = Array.isArray(projection?.rows) ? projection.rows : [];
const ice = chooseIce(rows);
const electrified = chooseElectrified(rows);
const pickup = choosePickup(rows);
const failures = [];

assertProof(Boolean(ice), failures, "No live ordinary M1/ICE candidate found in current public projection.");
assertProof(Boolean(electrified), failures, "No live EV/hybrid candidate found in current public projection.");
assertProof(Boolean(pickup), failures, "No live pickup/commercial candidate found in current public projection.");

const proof = {
  version: 1,
  auditedAt: new Date().toISOString(),
  mode: "production_public_read_only_recalculation",
  generationId: projection?.generationId || null,
  visibleOffers: rows.length,
  cases: {},
  failures,
};

if (ice) {
  const result = await calculate(ice);
  const snapshot = snapshotOf(result);
  const customs = customsOf(result);
  const caseFailures = [];
  assertProof(customs.status === "ready", caseFailures, `ICE customs did not resolve ready: ${candidateLabel(ice)}`);
  assertProof(positive(customs.totalCustomsRub) > 0, caseFailures, `ICE customs total is absent: ${candidateLabel(ice)}`);
  assertProof(positive(result.totalRub) > 0, caseFailures, `ICE final total is absent: ${candidateLabel(ice)}`);
  assertProof(["up_to_3_years", "from_3_to_5_years", "over_5_years"].includes(clean(customs.ageBand)), caseFailures, `ICE legal age band is absent: ${candidateLabel(ice)}`);
  assertProof(Math.round(positive(snapshot.customsValue?.totalRub)) === Math.round(positive(snapshot.sourcePriceRub)), caseFailures, `ICE customs value unexpectedly includes border transport: ${candidateLabel(ice)}`);
  if (customs.personalUseAssumed || customs.vehicleCategoryAssumed) {
    assertProof(snapshot.pricingConfidence === "estimated" && result.calculationStatus === "estimated", caseFailures, `ICE assumptions were not surfaced as estimated: ${candidateLabel(ice)}`);
  }
  proof.cases.ice = { pass: caseFailures.length === 0, failures: caseFailures, result: summarize(ice, result) };
  failures.push(...caseFailures);
}

if (electrified) {
  const result = await calculate(electrified);
  const snapshot = snapshotOf(result);
  const customs = customsOf(result);
  const caseFailures = [];
  const certifiedThirty = totalThirtyMinuteKw(result);
  assertProof(isElectrified(result), caseFailures, `Electrified candidate lost its powertrain identity: ${candidateLabel(electrified)}`);

  if (certifiedThirty > 0 && hasTrustedPower(result)) {
    assertProof(customs.status === "ready", caseFailures, `Certified EV/hybrid customs did not resolve ready: ${candidateLabel(electrified)}`);
    assertProof(snapshot.priceIncludesAllCustoms === true && snapshot.priceIncludesUtilizationFee === true, caseFailures, `Certified EV/hybrid claims an incomplete final price: ${candidateLabel(electrified)}`);
    assertProof(positive(result.totalRub) > 0, caseFailures, `Certified EV/hybrid final total is absent: ${candidateLabel(electrified)}`);

    if (clean(result.powertrainKind) === "electric") {
      const poisoned = {
        ...electrified,
        powerKw: Math.max(1000, positive(electrified.powerKw) * 4),
        powerHp: Math.max(1400, positive(electrified.powerHp) * 4),
      };
      const poisonedResult = await calculate(poisoned);
      const poisonedCustoms = customsOf(poisonedResult);
      assertProof(positive(poisonedCustoms.exciseRub) === positive(customs.exciseRub), caseFailures, `EV excise changed when only peak power was poisoned: ${candidateLabel(electrified)}`);
      assertProof(positive(poisonedCustoms.vatRub) === positive(customs.vatRub), caseFailures, `EV VAT changed when only peak power was poisoned: ${candidateLabel(electrified)}`);
      assertProof(positive(poisonedCustoms.utilizationFeeRub) === positive(customs.utilizationFeeRub), caseFailures, `EV utilization fee changed when only peak power was poisoned: ${candidateLabel(electrified)}`);
    }
  } else {
    assertProof(customs.status !== "ready", caseFailures, `EV/hybrid without trusted certified 30-minute power became customs-ready: ${candidateLabel(electrified)}`);
    assertProof(snapshot.priceIncludesAllCustoms !== true, caseFailures, `EV/hybrid without trusted certified 30-minute power claims all customs included: ${candidateLabel(electrified)}`);
    assertProof(snapshot.priceIncludesUtilizationFee !== true, caseFailures, `EV/hybrid without trusted certified 30-minute power claims utilization fee included: ${candidateLabel(electrified)}`);
    assertProof(["preliminary_power_pending", "needs_utilization_power", "needs_customs_data", "needs_power_data"].includes(clean(result.calculationStatus)), caseFailures, `EV/hybrid missing-power status is unsafe: ${candidateLabel(electrified)} -> ${result.calculationStatus}`);
  }
  proof.cases.electrified = { pass: caseFailures.length === 0, failures: caseFailures, result: summarize(electrified, result) };
  failures.push(...caseFailures);
}

if (pickup) {
  const result = await calculate(pickup);
  const snapshot = snapshotOf(result);
  const customs = customsOf(result);
  const caseFailures = [];
  const explicitCategory = normalizedCategory(pickup.vehicleCategory);
  const tnVed = clean(pickup.tnVedCode).replace(/\D/g, "");
  const explicitM1 = explicitCategory === "M1";

  if (explicitM1) {
    assertProof(customs.vehicleCategory === "M1" && customs.vehicleCategoryAssumed === false, caseFailures, `Explicit M1 pickup category was not preserved: ${candidateLabel(pickup)}`);
  } else {
    const blockedByMissingPower = clean(result.calculationStatus) === "needs_power_data"
      && positive(result.powerHp || pickup.powerHp) === 0
      && positive(result.powerKw || pickup.powerKw) === 0;
    assertProof(customs.status !== "ready", caseFailures, `Pickup without explicit M1 became customs-ready: ${candidateLabel(pickup)}`);
    assertProof(snapshot.priceIncludesAllCustoms !== true, caseFailures, `Pickup without explicit M1 claims all customs included: ${candidateLabel(pickup)}`);
    assertProof(positive(result.totalRub) === 0, caseFailures, `Pickup without explicit M1 received a public final total: ${candidateLabel(pickup)}`);
    const expectedMissing = explicitCategory === "N1" || tnVed.startsWith("8704") ? "n1_customs_tariff" : "vehicle_category";
    const categoryBlocked = customs.status === "needs_data"
      && Array.isArray(customs.missing)
      && customs.missing.includes(expectedMissing);
    // A live card can be rejected by the power gate before the customs engine
    // reaches vehicle-category validation. That is still fail-closed: it has no
    // customs-ready state, complete-price flags or public total. Prefer a
    // power-complete pickup above, but accept this earlier safe rejection when
    // production currently has no such candidate.
    assertProof(categoryBlocked || blockedByMissingPower, caseFailures, `Pickup fail-closed reason is missing (${expectedMissing}): ${candidateLabel(pickup)}`);
  }
  proof.cases.pickup = { pass: caseFailures.length === 0, failures: caseFailures, result: summarize(pickup, result) };
  failures.push(...caseFailures);
}

proof.pass = failures.length === 0;
await fs.writeFile(OUTPUT, `${JSON.stringify(proof, null, 2)}\n`);
console.log(JSON.stringify(proof, null, 2));

if (process.env.GITHUB_OUTPUT) {
  await fs.appendFile(process.env.GITHUB_OUTPUT, `pass=${proof.pass}\n`);
  await fs.appendFile(process.env.GITHUB_OUTPUT, `ice_id=${ice?.id || ""}\n`);
  await fs.appendFile(process.env.GITHUB_OUTPUT, `electrified_id=${electrified?.id || ""}\n`);
  await fs.appendFile(process.env.GITHUB_OUTPUT, `pickup_id=${pickup?.id || ""}\n`);
}

if (!proof.pass) process.exitCode = 1;
