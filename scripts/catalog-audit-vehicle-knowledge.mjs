import fs from "node:fs/promises";

const { readChunkedDataJson, readDataJson, writeDataJson } = await import("../apps/web/lib/data.ts");

const MODELS_PATH = "catalog/vehicle-knowledge/models.json";
const VARIANTS_PATH = "catalog/vehicle-knowledge/variants.json";
const POWER_KNOWLEDGE_PATH = "catalog/power-knowledge/vehicles.json";
const CERTIFIED_POWER_PATH = "catalog/power-reference/30-minute-power.json";
const HEALTH_PATH = "catalog/vehicle-knowledge/health-report.json";
const OUTPUT_PATH = process.env.CATALOG_VEHICLE_KNOWLEDGE_AUDIT_OUTPUT || "catalog-vehicle-knowledge-audit.json";
const MIN_MODELS = Math.max(1, Number(process.env.CATALOG_VEHICLE_KNOWLEDGE_MIN_MODELS || 5_000));
const MIN_RETAINED_RATIO = Math.min(1, Math.max(0.5, Number(process.env.CATALOG_VEHICLE_KNOWLEDGE_MIN_RETAINED_RATIO || 0.85)));
const RECENT_YEARS = Math.max(6, Math.min(15, Number(process.env.VEHICLE_KNOWLEDGE_RECENT_YEARS || 15)));
const RECENT_YEAR_FLOOR = new Date().getFullYear() - RECENT_YEARS + 1;
const MIN_RECENT_SPEC_COVERAGE = Math.min(1, Math.max(0, Number(process.env.CATALOG_VEHICLE_KNOWLEDGE_MIN_RECENT_SPEC_COVERAGE || 0)));

function positive(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function compact(value) {
  return String(value || "")
    .toLocaleLowerCase("ru-RU")
    .replace(/ё/g, "е")
    .replace(/&/g, "and")
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

function modelKey(make, model) {
  return `${compact(make)}:${compact(model)}`;
}

function modelIsRecent(model) {
  const yearFrom = Number(model?.yearFrom || 0);
  const yearTo = Number(model?.yearTo || 0);
  const newestKnownYear = Math.max(yearFrom, yearTo);
  if (newestKnownYear) return newestKnownYear >= RECENT_YEAR_FLOOR;
  return Number(model?.popularityDecile || 10) <= 5;
}

function ratio(value, total) {
  return total ? Number((value / total).toFixed(4)) : 0;
}

function duplicateIds(rows) {
  const counts = new Map();
  for (const row of rows) {
    const id = String(row?.id || "").trim();
    if (!id) continue;
    counts.set(id, Number(counts.get(id) || 0) + 1);
  }
  return [...counts.entries()].filter(([, count]) => count > 1).map(([id, count]) => ({ id, count }));
}

function hasThirtyMinutePower(row) {
  if (positive(row?.power30MinKw)) return true;
  return Array.isArray(row?.power30MinKwByMotor)
    && row.power30MinKwByMotor.some((value) => positive(value));
}

function hasTrustedSource(row) {
  return Boolean(
    String(row?.sourceUrl || "").trim()
    || String(row?.sourceDocumentId || "").trim()
    || String(row?.sourceVersion || "").trim(),
  );
}

const previous = await readDataJson(HEALTH_PATH, null).catch(() => null);
const [models, variants, powerKnowledge, certifiedPower] = await Promise.all([
  readChunkedDataJson(MODELS_PATH, []),
  readChunkedDataJson(VARIANTS_PATH, []),
  readChunkedDataJson(POWER_KNOWLEDGE_PATH, []),
  readChunkedDataJson(CERTIFIED_POWER_PATH, []),
]);

const activeModels = models.filter((row) => row?.active !== false && row?.id && row?.make && row?.model);
const activeVariants = variants.filter((row) => row?.active !== false && row?.id && row?.modelId && positive(row?.powerHp));
const activePowerKnowledge = powerKnowledge.filter((row) => row?.active !== false && row?.id && row?.make && row?.model);
const activeCertifiedPower = certifiedPower.filter((row) => row?.active !== false && row?.id && row?.make && row?.model);
const modelDuplicates = duplicateIds(activeModels);
const variantDuplicates = duplicateIds(activeVariants);
const previousModels = positive(previous?.counts?.models);
const retainedRatio = previousModels ? activeModels.length / previousModels : 1;
const collapseGuardMinimum = previousModels ? Math.floor(previousModels * MIN_RETAINED_RATIO) : MIN_MODELS;
const failures = [];

const variantsByModel = new Map();
for (const row of activeVariants) {
  const list = variantsByModel.get(row.modelId) || [];
  list.push(row);
  variantsByModel.set(row.modelId, list);
}
const powerByModel = new Map();
for (const row of activePowerKnowledge) {
  const key = modelKey(row.make, row.model);
  const list = powerByModel.get(key) || [];
  list.push(row);
  powerByModel.set(key, list);
}

const recentModels = activeModels.filter(modelIsRecent);
const recentModelsWithVariants = recentModels.filter((model) => (variantsByModel.get(model.id) || []).length > 0);
const recentModelsWithRepresentativePower = recentModels.filter((model) => positive(model.representativePowerHp));
const recentModelsWithPowerKnowledge = recentModels.filter((model) => (powerByModel.get(modelKey(model.make, model.model)) || []).length > 0);
const recentModelsWithAnySpecifications = recentModels.filter((model) => {
  return positive(model.representativePowerHp)
    || (variantsByModel.get(model.id) || []).length > 0
    || (powerByModel.get(modelKey(model.make, model.model)) || []).length > 0;
});
const recentModelsWithCoreSpecifications = recentModels.filter((model) => {
  const rows = [
    ...(variantsByModel.get(model.id) || []),
    ...(powerByModel.get(modelKey(model.make, model.model)) || []),
  ];
  return rows.some((row) => positive(row.powerHp) && (positive(row.engineCc) || row.fuel || row.powertrainKind));
});
const recentModelsWithThirtyMinutePower = recentModels.filter((model) => {
  const rows = [
    ...(variantsByModel.get(model.id) || []),
    ...(powerByModel.get(modelKey(model.make, model.model)) || []),
  ];
  return rows.some(hasThirtyMinutePower);
});
const recentSpecCoverage = ratio(recentModelsWithAnySpecifications.length, recentModels.length);

if (activeModels.length < MIN_MODELS) failures.push(`models_below_minimum_${activeModels.length}_below_${MIN_MODELS}`);
if (previousModels && activeModels.length < collapseGuardMinimum) failures.push(`models_collapse_${activeModels.length}_below_${collapseGuardMinimum}`);
if (modelDuplicates.length) failures.push(`duplicate_model_ids_${modelDuplicates.length}`);
if (variantDuplicates.length) failures.push(`duplicate_variant_ids_${variantDuplicates.length}`);
if (MIN_RECENT_SPEC_COVERAGE > 0 && recentSpecCoverage < MIN_RECENT_SPEC_COVERAGE) {
  failures.push(`recent_spec_coverage_${recentSpecCoverage}_below_${MIN_RECENT_SPEC_COVERAGE}`);
}

const report = {
  version: 2,
  auditedAt: new Date().toISOString(),
  status: failures.length ? "failed" : "healthy",
  thresholds: {
    minimumModels: MIN_MODELS,
    minimumRetainedRatio: MIN_RETAINED_RATIO,
    previousModels,
    collapseGuardMinimum,
    recentYears: RECENT_YEARS,
    recentYearFloor: RECENT_YEAR_FLOOR,
    minimumRecentSpecificationCoverage: MIN_RECENT_SPEC_COVERAGE,
  },
  counts: {
    models: activeModels.length,
    modelsFromVehiclesDb: activeModels.filter((row) => row.source === "vehiclesdb").length,
    manualOrOfficialModels: activeModels.filter((row) => row.source !== "vehiclesdb").length,
    modelsWithRepresentativePower: activeModels.filter((row) => positive(row.representativePowerHp)).length,
    modelRecordsWithSource: activeModels.filter(hasTrustedSource).length,
    variants: activeVariants.length,
    variantsWithThirtyMinutePower: activeVariants.filter(hasThirtyMinutePower).length,
    variantsWithTrustedSource: activeVariants.filter(hasTrustedSource).length,
    powerKnowledge: activePowerKnowledge.length,
    powerKnowledgeWithThirtyMinutePower: activePowerKnowledge.filter(hasThirtyMinutePower).length,
    certifiedPowerReferences: activeCertifiedPower.length,
    certifiedPowerReferencesWithThirtyMinutePower: activeCertifiedPower.filter(hasThirtyMinutePower).length,
  },
  recentCoverage: {
    years: RECENT_YEARS,
    yearFloor: RECENT_YEAR_FLOOR,
    models: recentModels.length,
    modelsWithAnySpecifications: recentModelsWithAnySpecifications.length,
    modelsWithCoreSpecifications: recentModelsWithCoreSpecifications.length,
    modelsWithVariants: recentModelsWithVariants.length,
    modelsWithRepresentativePower: recentModelsWithRepresentativePower.length,
    modelsWithPowerKnowledge: recentModelsWithPowerKnowledge.length,
    modelsWithThirtyMinutePower: recentModelsWithThirtyMinutePower.length,
    specificationCoverage: recentSpecCoverage,
    coreSpecificationCoverage: ratio(recentModelsWithCoreSpecifications.length, recentModels.length),
    variantCoverage: ratio(recentModelsWithVariants.length, recentModels.length),
  },
  retainedRatio: Number(retainedRatio.toFixed(4)),
  duplicateSamples: {
    models: modelDuplicates.slice(0, 100),
    variants: variantDuplicates.slice(0, 100),
  },
  failures,
};

await fs.writeFile(OUTPUT_PATH, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

if (failures.length) {
  process.exitCode = 1;
} else {
  await writeDataJson(HEALTH_PATH, report);
}
