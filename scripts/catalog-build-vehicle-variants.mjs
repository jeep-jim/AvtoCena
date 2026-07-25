import crypto from "node:crypto";

const { writeDataJson } = await import("../apps/web/lib/data.ts");
const { replaceChunkedDataJson } = await import("../apps/web/lib/replace-chunked-data.ts");
const { readAllOffersForMaintenance } = await import("../apps/web/lib/catalog/storage.ts");
const {
  findVehicleModel,
  readVehicleKnowledgeModels,
  readVehicleKnowledgeVariants,
  resetVehicleKnowledgeCache,
  vehicleKnowledgeToken,
} = await import("../apps/web/lib/catalog/vehicle-knowledge.ts");

const MODELS_PATH = "catalog/vehicle-knowledge/models.json";
const VARIANTS_PATH = "catalog/vehicle-knowledge/variants.json";
const CHUNK_SIZE = 250;
const offers = await readAllOffersForMaintenance();
const [models, existingVariants] = await Promise.all([
  readVehicleKnowledgeModels(),
  readVehicleKnowledgeVariants(),
]);
const modelById = new Map(models.map((model) => [model.id, model]));
const groups = new Map();

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function validPower(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 2_500 ? parsed : 0;
}

function roundedEngine(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed / 10) * 10 : 0;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round(((sorted[middle - 1] + sorted[middle]) / 2) * 10) / 10;
}

function candidatePower(offer) {
  const confidence = String(offer.powerDataConfidence || "");
  if (["estimated", "reference"].includes(confidence)) return 0;
  return validPower(offer.powerHp);
}

for (const offer of offers) {
  const powerHp = candidatePower(offer);
  if (!powerHp) continue;
  const match = await findVehicleModel(offer);
  if (!match) continue;
  const model = match.model;
  const year = Number(offer.year || 0);
  if (!year) continue;
  const engineCc = roundedEngine(offer.engineCc);
  const signature = [
    model.id,
    year,
    engineCc || "none",
    vehicleKnowledgeToken(offer.fuel) || "unknown",
    vehicleKnowledgeToken(offer.transmission) || "unknown",
    vehicleKnowledgeToken(offer.drive) || "unknown",
    vehicleKnowledgeToken(offer.generation) || "unknown",
  ].join("|");
  const list = groups.get(signature) || [];
  list.push({ offer, model, powerHp, engineCc });
  groups.set(signature, list);
}

const generated = [];
const conflicts = [];
const insufficientEvidence = [];
const generatedAt = new Date().toISOString();
for (const [signature, rows] of groups) {
  const powers = [...new Set(rows.map((row) => Math.round(row.powerHp * 10) / 10))];
  if (powers.length !== 1) {
    conflicts.push({ signature, powers, offerIds: rows.slice(0, 20).map((row) => row.offer.id) });
    continue;
  }
  const sample = rows[0];
  const sourceIds = [...new Set(rows.map((row) => clean(row.offer.sourceId)).filter(Boolean))];
  const hasDocumented = rows.some((row) => row.offer.powerDataConfidence === "documented");
  const hasSourceExact = rows.some((row) => row.offer.powerDataConfidence === "source_exact");
  if (!hasDocumented && !hasSourceExact && sourceIds.length < 2) {
    insufficientEvidence.push({ signature, powerHp: powers[0], sourceIds, offerIds: rows.slice(0, 20).map((row) => row.offer.id) });
    continue;
  }
  const confidence = hasDocumented ? "official_registry" : "source_consensus";
  const hash = crypto.createHash("sha256").update(`${signature}|${powers[0]}`).digest("hex").slice(0, 24);
  generated.push({
    id: `variant_${hash}`,
    modelId: sample.model.id,
    make: sample.model.make,
    model: sample.model.model,
    generation: clean(sample.offer.generation) || undefined,
    yearFrom: Number(sample.offer.year),
    yearTo: Number(sample.offer.year),
    engineCc: sample.engineCc || undefined,
    engineCcTolerance: sample.engineCc ? 80 : undefined,
    fuel: clean(sample.offer.fuel) || undefined,
    transmission: clean(sample.offer.transmission) || undefined,
    drive: clean(sample.offer.drive) || undefined,
    bodyType: clean(sample.offer.bodyType) || undefined,
    powertrainKind: sample.offer.powertrainKind && sample.offer.powertrainKind !== "unknown" ? sample.offer.powertrainKind : undefined,
    powerHp: powers[0],
    powerKw: Number(sample.offer.powerKw || 0) || Math.round((powers[0] / 1.35962) * 100) / 100,
    icePowerKw: Number(sample.offer.icePowerKw || 0) || undefined,
    power30MinKw: Number(sample.offer.power30MinKw || 0) || undefined,
    power30MinKwByMotor: Array.isArray(sample.offer.power30MinKwByMotor) && sample.offer.power30MinKwByMotor.length ? sample.offer.power30MinKwByMotor : undefined,
    utilizationPowerKw: Number(sample.offer.utilizationPowerKw || 0) || undefined,
    sourceType: confidence,
    sourceIds,
    sourceUrl: sample.offer.operational?.sourceUrl || undefined,
    verifiedAt: generatedAt,
    active: true,
  });
}

const protectedVariants = existingVariants.filter((variant) => ["manufacturer", "official_registry", "drom_catalog", "manual"].includes(String(variant.sourceType)));
const variantMap = new Map([...protectedVariants, ...generated].map((variant) => [variant.id, variant]));
const variants = [...variantMap.values()].sort((left, right) => left.make.localeCompare(right.make, "ru") || left.model.localeCompare(right.model, "ru") || Number(left.yearFrom || 0) - Number(right.yearFrom || 0));

const powersByModel = new Map();
for (const variant of variants) {
  const list = powersByModel.get(variant.modelId) || [];
  if (validPower(variant.powerHp)) list.push(Number(variant.powerHp));
  powersByModel.set(variant.modelId, list);
}
const nextModels = models.map((model) => {
  const powers = powersByModel.get(model.id) || [];
  if (!powers.length) return model;
  return { ...model, representativePowerHp: median(powers), updatedAt: generatedAt };
});

await replaceChunkedDataJson(VARIANTS_PATH, variants, CHUNK_SIZE);
await replaceChunkedDataJson(MODELS_PATH, nextModels, CHUNK_SIZE);
resetVehicleKnowledgeCache();

await writeDataJson("catalog/vehicle-knowledge/variant-build-report.json", {
  generatedAt,
  scannedOffers: offers.length,
  knownModels: modelById.size,
  candidateGroups: groups.size,
  generatedVariants: generated.length,
  protectedVariants: protectedVariants.length,
  totalVariants: variants.length,
  conflictCount: conflicts.length,
  insufficientEvidenceCount: insufficientEvidence.length,
  conflicts: conflicts.slice(0, 500),
  insufficientEvidence: insufficientEvidence.slice(0, 500),
});

console.log(JSON.stringify({
  generatedAt,
  scannedOffers: offers.length,
  generatedVariants: generated.length,
  totalVariants: variants.length,
  conflictCount: conflicts.length,
  insufficientEvidenceCount: insufficientEvidence.length,
  modelsWithRepresentativePower: nextModels.filter((model) => Number(model.representativePowerHp || 0) > 0).length,
}, null, 2));
