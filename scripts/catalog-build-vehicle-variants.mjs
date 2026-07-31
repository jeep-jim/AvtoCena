import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

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
const RECENT_YEAR = new Date().getFullYear() - 10;
const TRUSTED_EXACT_SOURCES = new Set([
  "encar_direct",
  "dubicars_uae_exact",
  "otomoto_europe_exact",
  "myauto_georgia_list",
  "auto_georgia_open",
  "mashina_kyrgyzstan_exact",
]);

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function validPower(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 2_500 ? parsed : 0;
}

function positive(value, maximum = 10_000) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= maximum ? parsed : 0;
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

function specCompleteness(offer) {
  return [
    roundedEngine(offer.engineCc),
    clean(offer.fuel),
    clean(offer.transmission),
    clean(offer.drive),
    clean(offer.bodyType),
    clean(offer.generation),
    offer.powertrainKind && offer.powertrainKind !== "unknown" ? offer.powertrainKind : "",
  ].filter(Boolean).length;
}

async function artifactOffers(inputDirectory) {
  if (!inputDirectory) return [];
  const result = [];
  async function walk(directory) {
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(file);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const payload = JSON.parse(await fs.readFile(file, "utf8").catch(() => "null"));
      if (Array.isArray(payload?.offers)) result.push(...payload.offers);
    }
  }
  await walk(inputDirectory);
  return result;
}

const storedOffers = await readAllOffersForMaintenance();
const collectedOffers = await artifactOffers(process.env.CATALOG_VARIANT_INPUT_DIR || "");
const offerMap = new Map();
for (const offer of [...storedOffers, ...collectedOffers]) {
  if (offer?.id) offerMap.set(String(offer.id), offer);
}
const offers = [...offerMap.values()];
const [models, existingVariants] = await Promise.all([
  readVehicleKnowledgeModels(),
  readVehicleKnowledgeVariants(),
]);
const modelById = new Map(models.map((model) => [model.id, model]));
const groups = new Map();

for (const offer of offers) {
  const year = Number(offer.year || 0);
  if (!year || year < 1950 || year > new Date().getFullYear() + 1) continue;
  if (specCompleteness(offer) < 1 && !candidatePower(offer)) continue;
  const match = await findVehicleModel(offer);
  if (!match) continue;
  const model = match.model;
  const engineCc = roundedEngine(offer.engineCc);
  const signature = [
    model.id,
    year,
    vehicleKnowledgeToken(offer.generation) || "unknown",
    engineCc || "none",
    vehicleKnowledgeToken(offer.fuel) || "unknown",
    vehicleKnowledgeToken(offer.transmission) || "unknown",
    vehicleKnowledgeToken(offer.drive) || "unknown",
    vehicleKnowledgeToken(offer.bodyType) || "unknown",
    vehicleKnowledgeToken(offer.powertrainKind) || "unknown",
  ].join("|");
  const list = groups.get(signature) || [];
  list.push({ offer, model, powerHp: candidatePower(offer), engineCc });
  groups.set(signature, list);
}

const generated = [];
const conflicts = [];
const insufficientEvidence = [];
const generatedAt = new Date().toISOString();
for (const [signature, rows] of groups) {
  const sample = rows[0];
  const sourceIds = [...new Set(rows.map((row) => clean(row.offer.sourceId)).filter(Boolean))];
  const hasTrustedExact = sourceIds.some((sourceId) => TRUSTED_EXACT_SOURCES.has(sourceId));
  const hasDocumented = rows.some((row) => row.offer.powerDataConfidence === "documented");
  const hasSourceExactPower = rows.some((row) => row.offer.powerDataConfidence === "source_exact");
  const completeness = Math.max(...rows.map((row) => specCompleteness(row.offer)));
  if (!hasDocumented && !hasTrustedExact && sourceIds.length < 2) {
    insufficientEvidence.push({ signature, completeness, sourceIds, offerIds: rows.slice(0, 20).map((row) => row.offer.id) });
    continue;
  }
  if (completeness < 2 && !rows.some((row) => row.powerHp)) {
    insufficientEvidence.push({ signature, completeness, sourceIds, offerIds: rows.slice(0, 20).map((row) => row.offer.id) });
    continue;
  }

  const powers = [...new Set(rows.map((row) => row.powerHp).filter(Boolean).map((value) => Math.round(value * 10) / 10))];
  const acceptedPower = powers.length === 1 && (hasDocumented || hasSourceExactPower || sourceIds.length >= 2 || hasTrustedExact)
    ? powers[0]
    : undefined;
  if (powers.length > 1) conflicts.push({ signature, field: "powerHp", values: powers, sourceIds, offerIds: rows.slice(0, 20).map((row) => row.offer.id) });

  const thirtyMinute = [...new Set(rows.map((row) => positive(row.offer.power30MinKw, 2_000)).filter(Boolean).map((value) => Math.round(value * 100) / 100))];
  if (thirtyMinute.length > 1) conflicts.push({ signature, field: "power30MinKw", values: thirtyMinute, sourceIds, offerIds: rows.slice(0, 20).map((row) => row.offer.id) });
  const icePowers = [...new Set(rows.map((row) => positive(row.offer.icePowerKw, 2_000)).filter(Boolean).map((value) => Math.round(value * 100) / 100))];
  const utilizationPowers = [...new Set(rows.map((row) => positive(row.offer.utilizationPowerKw, 4_000)).filter(Boolean).map((value) => Math.round(value * 100) / 100))];
  const hash = crypto.createHash("sha256").update(signature).digest("hex").slice(0, 24);
  const best = [...rows].sort((left, right) => specCompleteness(right.offer) - specCompleteness(left.offer) || Number(right.offer.year || 0) - Number(left.offer.year || 0))[0];
  generated.push({
    id: `variant_${hash}`,
    modelId: sample.model.id,
    make: sample.model.make,
    model: sample.model.model,
    generation: clean(best.offer.generation) || undefined,
    yearFrom: Number(sample.offer.year),
    yearTo: Number(sample.offer.year),
    engineCc: best.engineCc || undefined,
    engineCcTolerance: best.engineCc ? 80 : undefined,
    fuel: clean(best.offer.fuel) || undefined,
    transmission: clean(best.offer.transmission) || undefined,
    drive: clean(best.offer.drive) || undefined,
    bodyType: clean(best.offer.bodyType) || undefined,
    powertrainKind: best.offer.powertrainKind && best.offer.powertrainKind !== "unknown" ? best.offer.powertrainKind : undefined,
    powerHp: acceptedPower,
    powerKw: positive(best.offer.powerKw, 2_000) || (acceptedPower ? Math.round((acceptedPower / 1.35962) * 100) / 100 : undefined),
    icePowerKw: icePowers.length === 1 ? icePowers[0] : undefined,
    power30MinKw: thirtyMinute.length === 1 ? thirtyMinute[0] : undefined,
    power30MinKwByMotor: Array.isArray(best.offer.power30MinKwByMotor) && best.offer.power30MinKwByMotor.length ? best.offer.power30MinKwByMotor : undefined,
    utilizationPowerKw: utilizationPowers.length === 1 ? utilizationPowers[0] : undefined,
    sourceType: hasDocumented ? "official_registry" : "source_consensus",
    sourceIds,
    sourceUrl: best.offer.operational?.sourceUrl || undefined,
    verifiedAt: generatedAt,
    active: true,
  });
}

const protectedVariants = existingVariants.filter((variant) => ["manufacturer", "official_registry", "drom_catalog", "manual"].includes(String(variant.sourceType)));
const variantMap = new Map([...generated, ...protectedVariants].map((variant) => [variant.id, variant]));
const variants = [...variantMap.values()].sort((left, right) => {
  const leftRecent = Number(left.yearTo || left.yearFrom || 0) >= RECENT_YEAR ? 0 : 1;
  const rightRecent = Number(right.yearTo || right.yearFrom || 0) >= RECENT_YEAR ? 0 : 1;
  return leftRecent - rightRecent
    || left.make.localeCompare(right.make, "ru")
    || left.model.localeCompare(right.model, "ru")
    || Number(right.yearFrom || 0) - Number(left.yearFrom || 0);
});

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

const recentVariants = variants.filter((variant) => Number(variant.yearTo || variant.yearFrom || 0) >= RECENT_YEAR);
const variantsWithPower = variants.filter((variant) => validPower(variant.powerHp));
const variantsWithCoreSpecs = variants.filter((variant) => [variant.engineCc, variant.fuel, variant.transmission, variant.drive, variant.bodyType].filter(Boolean).length >= 3);
await writeDataJson("catalog/vehicle-knowledge/variant-build-report.json", {
  generatedAt,
  storedOffers: storedOffers.length,
  collectedOffers: collectedOffers.length,
  scannedOffers: offers.length,
  knownModels: modelById.size,
  candidateGroups: groups.size,
  generatedVariants: generated.length,
  generatedPowerVariants: generated.filter((variant) => validPower(variant.powerHp)).length,
  generatedSpecOnlyVariants: generated.filter((variant) => !validPower(variant.powerHp)).length,
  protectedVariants: protectedVariants.length,
  totalVariants: variants.length,
  recentVariants: recentVariants.length,
  variantsWithPower: variantsWithPower.length,
  variantsWithCoreSpecs: variantsWithCoreSpecs.length,
  conflictCount: conflicts.length,
  insufficientEvidenceCount: insufficientEvidence.length,
  conflicts: conflicts.slice(0, 1_000),
  insufficientEvidence: insufficientEvidence.slice(0, 1_000),
});

console.log(JSON.stringify({
  generatedAt,
  storedOffers: storedOffers.length,
  collectedOffers: collectedOffers.length,
  scannedOffers: offers.length,
  generatedVariants: generated.length,
  totalVariants: variants.length,
  recentVariants: recentVariants.length,
  variantsWithPower: variantsWithPower.length,
  variantsWithCoreSpecs: variantsWithCoreSpecs.length,
  conflictCount: conflicts.length,
  insufficientEvidenceCount: insufficientEvidence.length,
  modelsWithRepresentativePower: nextModels.filter((model) => Number(model.representativePowerHp || 0) > 0).length,
}, null, 2));
