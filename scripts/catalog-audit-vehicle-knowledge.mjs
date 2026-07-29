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

function positive(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
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

if (activeModels.length < MIN_MODELS) failures.push(`models_below_minimum_${activeModels.length}_below_${MIN_MODELS}`);
if (previousModels && activeModels.length < collapseGuardMinimum) failures.push(`models_collapse_${activeModels.length}_below_${collapseGuardMinimum}`);
if (modelDuplicates.length) failures.push(`duplicate_model_ids_${modelDuplicates.length}`);
if (variantDuplicates.length) failures.push(`duplicate_variant_ids_${variantDuplicates.length}`);

const report = {
  version: 1,
  auditedAt: new Date().toISOString(),
  status: failures.length ? "failed" : "healthy",
  thresholds: {
    minimumModels: MIN_MODELS,
    minimumRetainedRatio: MIN_RETAINED_RATIO,
    previousModels,
    collapseGuardMinimum,
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
