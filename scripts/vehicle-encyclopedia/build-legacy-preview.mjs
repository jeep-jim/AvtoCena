import { mkdir } from "node:fs/promises";
import path from "node:path";
import { WORKSPACE_ROOT, byId, loadWorkspace, readJson, writeJson } from "./lib.mjs";
import { validateWorkspace } from "./validate.mjs";

const LEGACY_ROOT = path.resolve(WORKSPACE_ROOT, "../vehicle-knowledge");

async function readLegacyCollection(collection) {
  const index = await readJson(path.join(LEGACY_ROOT, `${collection}-index.json`));
  const chunks = await Promise.all(index.chunks.map((chunk) => readJson(path.join(LEGACY_ROOT, chunk.file))));
  return { index, rows: chunks.flat() };
}

function year(value) {
  const match = String(value || "").match(/^(\d{4})/);
  return match ? Number(match[1]) : undefined;
}

function compact(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined && value !== null && (!Array.isArray(value) || value.length)));
}

function safeAliases(entity, allowedKinds = null) {
  return (entity.aliases || []).filter((alias) => alias.safe && (!allowedKinds || allowedKinds.has(alias.kind))).map((alias) => alias.value);
}

function legacyPowertrain(kind) {
  if (["ICE", "MHEV"].includes(kind)) return "combustion";
  if (["BEV", "FCEV"].includes(kind)) return "electric";
  if (kind === "EREV") return "series_hybrid";
  if (["HEV", "PHEV"].includes(kind)) return "other_hybrid";
  return undefined;
}

function sourceType(source) {
  if (["government_registry", "type_approval", "homologation"].includes(source?.type)) return "official_registry";
  if (["manufacturer", "manufacturer_technical_document"].includes(source?.type)) return "manufacturer";
  return "manual";
}

const validation = await validateWorkspace();
if (validation.errors.length) {
  console.error(JSON.stringify({ built: false, errors: validation.errors }, null, 2));
  process.exitCode = 1;
} else {
  const data = await loadWorkspace();
  const [legacyModels, legacyVariants] = await Promise.all([readLegacyCollection("models"), readLegacyCollection("variants")]);
  const brands = byId(data.records.brand);
  const models = byId(data.records.model);
  const generations = byId(data.records.generation);
  const facelifts = byId(data.records.facelift);
  const sources = byId(data.records.source);

  const excludedModels = data.records.model
    .filter((model) => model.status !== "verified")
    .map((model) => ({ entityId: model.id, reason: "entity_status_not_verified" }));
  const modelPreview = data.records.model.filter((model) => model.status === "verified").map((model) => {
    const brand = brands.get(model.brandId);
    const evidenceSource = sources.get(model.evidence.find((item) => item.status === "verified")?.sourceId);
    return compact({
      id: model.id,
      make: brand?.canonicalName,
      model: model.canonicalName,
      makeAliases: safeAliases(brand || {}, new Set(["localized", "market_name", "punctuation", "transliteration"])),
      aliases: safeAliases(model),
      bodyTypes: model.bodyTypes.map((value) => value.toLocaleLowerCase("en")),
      countries: brand?.countries,
      yearFrom: year(model.productionFrom),
      yearTo: year(model.productionTo),
      source: evidenceSource?.type?.startsWith("manufacturer") ? "manufacturer" : "manual",
      sourceVersion: "Encyclopedia V2 pilot preview",
      sourceUrl: evidenceSource?.url,
      updatedAt: `${model.updatedAt}T00:00:00.000Z`,
      active: true,
    });
  });

  const excludedVariants = [];
  const variantPreview = [];
  for (const variant of data.records.variant) {
    if (variant.status !== "verified") {
      excludedVariants.push({ entityId: variant.id, reason: "entity_status_not_verified" });
      continue;
    }
    if (!variant.powerHp) {
      excludedVariants.push({ entityId: variant.id, reason: "legacy_requires_exact_powerHp; conversion from powerKw is not performed" });
      continue;
    }
    const model = models.get(variant.modelId);
    const brand = brands.get(model?.brandId);
    const generation = generations.get(variant.generationId);
    const facelift = variant.faceliftId ? facelifts.get(variant.faceliftId) : null;
    const verifiedEvidence = variant.evidence.filter((item) => item.status === "verified");
    const primarySource = sources.get(verifiedEvidence[0]?.sourceId);
    variantPreview.push(compact({
      id: variant.id,
      modelId: variant.modelId,
      make: brand?.canonicalName,
      model: model?.canonicalName,
      generation: generation?.name,
      generationAliases: [...new Set([...(generation?.platformCodes || []), ...safeAliases(generation || {})])],
      yearFrom: variant.yearFrom,
      yearTo: variant.yearTo,
      productionFrom: facelift?.productionFrom || generation?.productionFrom,
      productionTo: facelift?.productionTo || generation?.productionTo,
      engineCc: variant.engineCc,
      fuel: variant.fuel,
      transmission: variant.transmission,
      drive: variant.drive,
      bodyType: variant.bodyType.toLocaleLowerCase("en"),
      powertrainKind: legacyPowertrain(variant.powertrainKind),
      powerHp: variant.powerHp,
      powerKw: variant.powerKw,
      icePowerKw: variant.icePowerKw,
      power30MinKw: variant.power30MinKw,
      power30MinKwByMotor: variant.power30MinKwByMotor,
      sourceType: sourceType(primarySource),
      sourceIds: [...new Set(verifiedEvidence.map((item) => item.sourceId))],
      sourceUrl: primarySource?.url,
      verifiedAt: `${primarySource?.verifiedAt || variant.updatedAt}T00:00:00.000Z`,
      active: true,
    }));
  }

  const legacyModelIds = new Set(legacyModels.rows.map((row) => row.id));
  const legacyVariantIds = new Set(legacyVariants.rows.map((row) => row.id));
  const report = {
    schemaVersion: 1,
    productionModified: false,
    rule: "Review-only preview. Never writes data/catalog/vehicle-knowledge.",
    legacyBaseline: {
      models: legacyModels.index.total,
      modelChunks: legacyModels.index.chunks.length,
      variants: legacyVariants.index.total,
      variantChunks: legacyVariants.index.chunks.length,
      maxRecordsPerChunk: Math.max(legacyModels.index.maxRecordsPerChunk, legacyVariants.index.maxRecordsPerChunk),
    },
    preview: { models: modelPreview.length, variants: variantPreview.length },
    existingIdReview: {
      models: modelPreview.filter((row) => legacyModelIds.has(row.id)).map((row) => row.id),
      variants: variantPreview.filter((row) => legacyVariantIds.has(row.id)).map((row) => row.id),
    },
    excludedModels,
    excludedVariants,
    gatesBeforePublication: [
      "human review of every mapped field and existing-ID merge",
      "exact powerHp required by the current legacy variant contract",
      "real catalog spelling and ambiguity regression",
      "production chunk rebuild capped at 250 records",
      "separate authorization to modify production data",
    ],
  };
  const output = path.join(WORKSPACE_ROOT, "generated/legacy-bridge-preview");
  await mkdir(output, { recursive: true });
  await writeJson(path.join(output, "models.json"), modelPreview);
  await writeJson(path.join(output, "variants.json"), variantPreview);
  await writeJson(path.join(output, "report.json"), report);
  console.log(JSON.stringify({ built: true, ...report.preview, excludedModels: excludedModels.length, excludedVariants: excludedVariants.length, productionModified: false }, null, 2));
}
