import crypto from "node:crypto";

const { mutateDataJson, writeDataJson } = await import("../apps/web/lib/data.ts");
const { calculateOfferWithRussiaCustoms } = await import("../apps/web/lib/catalog/customs-pricing.ts");
const {
  findCertifiedPowerReference,
  getCertifiedPowerReferences,
} = await import("../apps/web/lib/catalog/power-reference.ts");
const {
  persistCatalogOffers,
  readAllOffersForMaintenance,
} = await import("../apps/web/lib/catalog/storage.ts");

const APPLY = ["1", "true", "yes", "on"].includes(String(process.env.CATALOG_CERTIFIED_POWER_APPLY || "").toLowerCase());
const WRITE_REPORT = ["1", "true", "yes", "on"].includes(String(process.env.CATALOG_CERTIFIED_POWER_WRITE_REPORT || "").toLowerCase());
const MAX_OFFERS = Math.max(0, Number(process.env.CATALOG_CERTIFIED_POWER_MAX_OFFERS || 0));
const LOCK_PATH = "catalog/import-lock.json";
const REPORT_PATH = "catalog/power-reference/apply-report.json";
const operationId = `catalog_certified_power_${crypto.randomUUID()}`;
const startedAt = new Date().toISOString();
let lockHeld = false;

function positive(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function electrified(offer) {
  const kind = String(offer?.powertrainKind || "").toLowerCase();
  const fuel = String(offer?.fuel || "").toLowerCase();
  return ["electric", "series_hybrid", "other_hybrid"].includes(kind)
    || /electric|электро|hybrid|гибрид|bev|phev|hev/.test(fuel);
}

function comparisonSnapshot(offer) {
  return JSON.stringify({
    powertrainKind: offer?.powertrainKind,
    icePowerKw: offer?.icePowerKw,
    power30MinKw: offer?.power30MinKw,
    power30MinKwByMotor: offer?.power30MinKwByMotor,
    utilizationPowerKw: offer?.utilizationPowerKw,
    powerDataConfidence: offer?.powerDataConfidence,
    powerDataSource: offer?.powerDataSource,
    calculationStatus: offer?.calculationStatus,
    totalRub: offer?.totalRub,
    customs: offer?.calculationSnapshot?.customs,
    pricingConfidence: offer?.calculationSnapshot?.pricingConfidence,
    priceIncludesUtilizationFee: offer?.calculationSnapshot?.priceIncludesUtilizationFee,
    certifiedPowerReference: offer?.operational?.raw?.certifiedPowerReference?.id,
  });
}

async function acquireLock() {
  await mutateDataJson(LOCK_PATH, { lockedUntil: "" }, (current) => {
    const lockedUntil = Date.parse(String(current?.lockedUntil || ""));
    if (Number.isFinite(lockedUntil) && lockedUntil > Date.now()) {
      throw new Error(`catalog_import_locked_until_${new Date(lockedUntil).toISOString()}`);
    }
    return {
      operationId,
      operationType: "certified_power_apply",
      lockedUntil: new Date(Date.now() + 30 * 60_000).toISOString(),
      startedAt,
    };
  });
  lockHeld = true;
}

async function refreshLock() {
  if (!lockHeld) return;
  await mutateDataJson(LOCK_PATH, { lockedUntil: "" }, (current) => {
    if (current?.operationId !== operationId) throw new Error("catalog_certified_power_lock_lost");
    return {
      ...current,
      lockedUntil: new Date(Date.now() + 30 * 60_000).toISOString(),
      heartbeatAt: new Date().toISOString(),
    };
  });
}

async function releaseLock(error) {
  if (!lockHeld) return;
  await mutateDataJson(LOCK_PATH, { lockedUntil: "" }, (current) => current?.operationId === operationId
    ? {
      operationId,
      operationType: "certified_power_apply",
      lockedUntil: "",
      finishedAt: new Date().toISOString(),
      ...(error ? { error: String(error?.message || error).slice(0, 500) } : {}),
    }
    : current);
  lockHeld = false;
}

const report = {
  operationId,
  startedAt,
  mode: APPLY ? "apply" : "dry-run",
  referenceCount: 0,
  scannedOffers: 0,
  electrifiedOffers: 0,
  matchedOffers: 0,
  changedOffers: 0,
  exactReadyOffers: 0,
  stillPreliminaryOffers: 0,
  failedOffers: 0,
  referencesUsed: {},
  sampleChanges: [],
  failures: [],
};

let fatalError = null;
try {
  if (APPLY) await acquireLock();
  const references = await getCertifiedPowerReferences();
  report.referenceCount = references.length;
  const allOffers = await readAllOffersForMaintenance();
  const candidates = allOffers
    .filter((offer) => offer?.status === "active" && electrified(offer))
    .slice(0, MAX_OFFERS || undefined);
  report.scannedOffers = allOffers.length;
  report.electrifiedOffers = candidates.length;
  const byId = new Map(allOffers.map((offer) => [offer.id, offer]));

  for (let index = 0; index < candidates.length; index++) {
    const offer = candidates[index];
    try {
      const reference = await findCertifiedPowerReference(offer);
      if (!reference) continue;
      report.matchedOffers++;
      report.referencesUsed[reference.id] = Number(report.referencesUsed[reference.id] || 0) + 1;
      const before = comparisonSnapshot(offer);
      const calculated = await calculateOfferWithRussiaCustoms(offer);
      const appliedReferenceId = calculated?.operational?.raw?.certifiedPowerReference?.id;
      if (appliedReferenceId !== reference.id) throw new Error(`certified_reference_not_applied:${reference.id}`);
      if (comparisonSnapshot(calculated) === before) continue;
      byId.set(calculated.id, calculated);
      report.changedOffers++;
      if (String(calculated.calculationStatus) === "preliminary_power_pending") report.stillPreliminaryOffers++;
      else if (positive(calculated.totalRub) && calculated.calculationSnapshot?.priceIncludesUtilizationFee === true) report.exactReadyOffers++;
      if (report.sampleChanges.length < 100) {
        report.sampleChanges.push({
          id: calculated.id,
          market: calculated.market,
          make: calculated.make,
          model: calculated.model,
          year: calculated.year,
          referenceId: reference.id,
          power30MinKw: calculated.power30MinKw,
          utilizationPowerKw: calculated.utilizationPowerKw,
          calculationStatus: calculated.calculationStatus,
          totalRub: calculated.totalRub,
        });
      }
    } catch (error) {
      report.failedOffers++;
      if (report.failures.length < 100) report.failures.push({ id: offer.id, error: String(error?.message || error).slice(0, 500) });
    }
    if (APPLY && (index + 1) % 100 === 0) await refreshLock();
  }

  if (APPLY && report.changedOffers > 0) {
    await refreshLock();
    await persistCatalogOffers([...byId.values()]);
  }
  report.finishedAt = new Date().toISOString();
  report.persisted = APPLY && report.changedOffers > 0;
  if (WRITE_REPORT) await writeDataJson(REPORT_PATH, report);
  console.log(JSON.stringify(report, null, 2));
  if (report.failedOffers > 0) process.exitCode = 2;
} catch (error) {
  fatalError = error;
  report.finishedAt = new Date().toISOString();
  report.fatalError = String(error?.message || error).slice(0, 1_000);
  console.error(JSON.stringify(report, null, 2));
  process.exitCode = 1;
} finally {
  await releaseLock(fatalError).catch((error) => {
    console.error(`catalog_certified_power_lock_release_failed:${String(error?.message || error)}`);
    process.exitCode = 1;
  });
}
