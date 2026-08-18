import { mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  ENTITY_TYPES,
  WORKSPACE_ROOT,
  brandForEntity,
  byId,
  evidenceFields,
  isPresent,
  loadWorkspace,
  modelForEntity,
  normalizeTerm,
  readJson,
  sourceDomain,
  writeJson,
} from "./lib.mjs";
import { validateJsonSchema } from "./contract.mjs";

const COLLECTION_FILE_PREFIX = {
  source: "sources",
  brand: "brands",
  model: "models",
  generation: "generations",
  facelift: "facelifts",
  variant: "variants",
  media: "media",
};

const REQUIRED = {
  source: ["id", "type", "title", "publisher", "url", "verifiedAt", "supportedFields", "confidence", "status"],
  brand: ["id", "canonicalName", "slug", "aliases", "countries", "status", "evidence", "updatedAt"],
  model: ["id", "brandId", "canonicalName", "slug", "aliases", "productionFrom", "productionTo", "bodyTypes", "powertrainKinds", "mediaIds", "status", "evidence", "updatedAt"],
  generation: ["id", "modelId", "name", "aliases", "platformCodes", "productionFrom", "productionTo", "bodyTypes", "status", "evidence", "updatedAt"],
  facelift: ["id", "generationId", "name", "aliases", "productionFrom", "productionTo", "status", "evidence", "updatedAt"],
  variant: ["id", "modelId", "generationId", "name", "market", "yearFrom", "yearTo", "bodyType", "powertrainKind", "status", "evidence", "updatedAt"],
  media: ["id", "ownerType", "ownerId", "role", "sourceId", "originalUrl", "pageUrl", "license", "attribution", "identityStatus", "status", "verifiedAt"],
};

const FACT_FIELDS = {
  brand: ["canonicalName", "countries"],
  model: ["canonicalName", "productionFrom", "productionTo", "bodyTypes", "powertrainKinds"],
  generation: ["name", "platformCodes", "productionFrom", "productionTo", "bodyTypes"],
  facelift: ["name", "productionFrom", "productionTo"],
  variant: [
    "name", "market", "yearFrom", "yearTo", "bodyType", "powertrainKind", "fuel", "engineCode", "engineCc",
    "steeringPosition", "transmission", "gears", "drive", "powerHp", "powerHpStandard", "powerKw", "icePowerKw", "motorPeakKw", "power30MinKw", "power30MinKwByMotor",
    "batteryGrossKwh", "batteryUsableKwh", "batteryRatedKwh", "rangeKm", "rangeKmMin", "rangeKmMax", "rangeStandard", "acChargeKw", "dcChargeKw",
    "lengthMm", "widthMm", "heightMm", "wheelbaseMm", "curbWeightKg", "grossWeightKg", "groundClearanceMm", "tankCapacityL", "seats", "doors",
    "zeroTo100Sec", "topSpeedKmh",
  ],
};

const RECOMMENDED_VARIANT_FIELDS = [
  "fuel", "transmission", "drive", "powerKw", "lengthMm", "widthMm", "heightMm", "wheelbaseMm", "curbWeightKg", "seats", "doors",
];
const POWER_30_SOURCE_TYPES = new Set(["government_registry", "type_approval", "homologation", "manufacturer_technical_document"]);

function issue(list, code, message, context = {}) {
  list.push({ code, message, ...context });
}

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function validMonth(value) {
  if (value === null) return true;
  return /^\d{4}(-(?:0[1-9]|1[0-2]))?$/.test(String(value || ""));
}

function countBy(rows, key) {
  return Object.fromEntries([...rows.reduce((map, row) => {
    const value = key(row);
    map.set(value, (map.get(value) || 0) + 1);
    return map;
  }, new Map())].sort(([left], [right]) => String(left).localeCompare(String(right))));
}

function aliasRows(entity, entityType, indexes) {
  const canonical = entity.canonicalName || entity.name;
  const values = canonical ? [{ value: canonical, kind: "canonical", safe: true, sourceIds: [] }] : [];
  values.push(...(entity.aliases || []), ...(entity.sourceNames || []));
  return values.map((alias) => ({
    normalized: normalizeTerm(alias.value),
    value: alias.value,
    kind: alias.kind,
    safe: alias.safe,
    entityType,
    entityId: entity.id,
    brandId: entityType === "brand" ? entity.id : brandForEntity(entity, indexes),
    modelId: entityType === "model" ? entity.id : modelForEntity(entity, indexes),
  })).filter((row) => row.normalized);
}

export async function validateWorkspace({ root = WORKSPACE_ROOT, writeReports = false } = {}) {
  const data = await loadWorkspace(root);
  const errors = [];
  const warnings = [];
  const allIds = new Map();
  const chunkSchema = await readJson(path.join(root, "schema/entity-chunk.schema.json"));

  for (const { file, chunk } of data.chunks) {
    for (const violation of validateJsonSchema(chunk, chunkSchema)) {
      issue(errors, "schema.contract", violation.message, { file, path: violation.path, keyword: violation.keyword });
    }
    if (chunk.schemaVersion !== 2) issue(errors, "chunk.schema_version", "schemaVersion must equal 2", { file });
    if (!ENTITY_TYPES.includes(chunk.entityType)) issue(errors, "chunk.entity_type", "Unknown entityType", { file, entityType: chunk.entityType });
    if (chunk.maxRecords !== 250) issue(errors, "chunk.max_records", "maxRecords must equal 250", { file });
    if (!Number.isInteger(chunk.chunk) || chunk.chunk < 1) issue(errors, "chunk.number", "chunk must be a positive integer", { file });
    if (!Array.isArray(chunk.records)) issue(errors, "chunk.records", "records must be an array", { file });
    if ((chunk.records || []).length > 250) issue(errors, "chunk.overflow", "Chunk exceeds 250 records", { file, records: chunk.records.length });
    const expectedPrefix = COLLECTION_FILE_PREFIX[chunk.entityType];
    if (expectedPrefix && !file.startsWith(`${expectedPrefix}-`)) issue(errors, "chunk.filename", "Filename does not match entityType", { file, entityType: chunk.entityType });
  }

  for (const type of ENTITY_TYPES) {
    for (const entity of data.records[type]) {
      for (const field of REQUIRED[type]) {
        if (!(field in entity)) issue(errors, "entity.required", `Missing required field ${field}`, { entityType: type, entityId: entity.id || null });
      }
      if (!entity.id || !/^[a-z0-9][a-z0-9._/-]*$/.test(entity.id)) issue(errors, "entity.id", "Invalid entity id", { entityType: type, entityId: entity.id || null });
      const previous = allIds.get(entity.id);
      if (previous) issue(errors, "entity.duplicate_id", "Duplicate entity id", { entityType: type, entityId: entity.id, previousType: previous });
      else allIds.set(entity.id, type);
      if (entity.updatedAt && !validDate(entity.updatedAt)) issue(errors, "entity.updated_at", "updatedAt must be YYYY-MM-DD", { entityType: type, entityId: entity.id });
    }
  }

  const indexes = {
    sources: byId(data.records.source),
    brands: byId(data.records.brand),
    models: byId(data.records.model),
    generations: byId(data.records.generation),
    facelifts: byId(data.records.facelift),
    variants: byId(data.records.variant),
    media: byId(data.records.media),
  };

  for (const source of data.records.source) {
    if (!validDate(source.verifiedAt)) issue(errors, "source.verified_at", "Source verifiedAt must be a real YYYY-MM-DD date", { sourceId: source.id });
    try { new URL(source.url); } catch { issue(errors, "source.url", "Source URL is invalid", { sourceId: source.id }); }
    if (!Array.isArray(source.supportedFields) || !source.supportedFields.length) issue(errors, "source.supported_fields", "Source must declare supportedFields", { sourceId: source.id });
  }

  for (const type of ["brand", "model", "generation", "facelift", "variant"]) {
    for (const entity of data.records[type]) {
      const fields = evidenceFields(entity);
      for (const item of entity.evidence || []) {
        const source = indexes.sources.get(item.sourceId);
        if (!source) {
          issue(errors, "evidence.source_missing", "Evidence references an unknown source", { entityType: type, entityId: entity.id, sourceId: item.sourceId });
          continue;
        }
        for (const field of item.fields || []) {
          if (!source.supportedFields.includes(field)) issue(errors, "evidence.field_not_supported", "Evidence field is not declared by the source", { entityType: type, entityId: entity.id, sourceId: item.sourceId, field });
        }
      }
      for (const field of FACT_FIELDS[type] || []) {
        if (isPresent(entity[field]) && !fields.has(field)) issue(errors, "evidence.field_missing", "Factual field has no evidence", { entityType: type, entityId: entity.id, field });
      }
      for (const alias of [...(entity.aliases || []), ...(entity.sourceNames || [])]) {
        if (!alias.value || !Array.isArray(alias.sourceIds) || !alias.sourceIds.length) issue(errors, "alias.source_missing", "Alias must reference at least one source", { entityType: type, entityId: entity.id, alias: alias.value || null });
        for (const sourceId of alias.sourceIds || []) if (!indexes.sources.has(sourceId)) issue(errors, "alias.source_unknown", "Alias references an unknown source", { entityType: type, entityId: entity.id, alias: alias.value, sourceId });
      }
    }
  }

  for (const model of data.records.model) {
    if (!indexes.brands.has(model.brandId)) issue(errors, "relation.brand_missing", "Model references an unknown brand", { entityId: model.id, brandId: model.brandId });
    if (!validMonth(model.productionFrom) || !validMonth(model.productionTo)) issue(errors, "range.production_format", "Model production range must use YYYY or YYYY-MM", { entityId: model.id });
    if (model.productionFrom && model.productionTo && model.productionFrom > model.productionTo) issue(errors, "range.production_order", "Model productionFrom is after productionTo", { entityId: model.id });
    const covers = (model.mediaIds || []).map((id) => indexes.media.get(id)).filter(Boolean).filter((media) => media.role === "canonical_cover" && media.status === "approved" && ["exact_model", "exact_generation"].includes(media.identityStatus));
    if (!covers.length) issue(errors, "media.cover_missing", "Model must reference an approved canonical cover with verified identity", { entityId: model.id });
  }
  for (const generation of data.records.generation) {
    if (!indexes.models.has(generation.modelId)) issue(errors, "relation.model_missing", "Generation references an unknown model", { entityId: generation.id, modelId: generation.modelId });
    if (!validMonth(generation.productionFrom) || !validMonth(generation.productionTo)) issue(errors, "range.production_format", "Generation production range must use YYYY or YYYY-MM", { entityId: generation.id });
    if (generation.productionFrom && generation.productionTo && generation.productionFrom > generation.productionTo) issue(errors, "range.production_order", "Generation productionFrom is after productionTo", { entityId: generation.id });
  }
  for (const facelift of data.records.facelift) {
    if (!indexes.generations.has(facelift.generationId)) issue(errors, "relation.generation_missing", "Facelift references an unknown generation", { entityId: facelift.id, generationId: facelift.generationId });
    if (!validMonth(facelift.productionFrom) || !validMonth(facelift.productionTo)) issue(errors, "range.production_format", "Facelift production range must use YYYY or YYYY-MM", { entityId: facelift.id });
    if (facelift.productionFrom && facelift.productionTo && facelift.productionFrom > facelift.productionTo) issue(errors, "range.production_order", "Facelift productionFrom is after productionTo", { entityId: facelift.id });
  }
  for (const variant of data.records.variant) {
    const generation = indexes.generations.get(variant.generationId);
    if (!indexes.models.has(variant.modelId)) issue(errors, "relation.model_missing", "Variant references an unknown model", { entityId: variant.id, modelId: variant.modelId });
    if (!generation) issue(errors, "relation.generation_missing", "Variant references an unknown generation", { entityId: variant.id, generationId: variant.generationId });
    else if (generation.modelId !== variant.modelId) issue(errors, "relation.generation_model_mismatch", "Variant model and generation do not agree", { entityId: variant.id });
    if (variant.faceliftId) {
      const facelift = indexes.facelifts.get(variant.faceliftId);
      if (!facelift) issue(errors, "relation.facelift_missing", "Variant references an unknown facelift", { entityId: variant.id, faceliftId: variant.faceliftId });
      else if (facelift.generationId !== variant.generationId) issue(errors, "relation.facelift_generation_mismatch", "Variant generation and facelift do not agree", { entityId: variant.id });
    }
    if (variant.yearTo && variant.yearFrom > variant.yearTo) issue(errors, "range.year_order", "Variant yearFrom is after yearTo", { entityId: variant.id });
    for (const field of ["power30MinKw", "power30MinKwByMotor"]) {
      if (!isPresent(variant[field])) continue;
      const evidence = evidenceFields(variant).get(field) || [];
      const eligible = evidence.filter((item) => item.status === "verified" && POWER_30_SOURCE_TYPES.has(indexes.sources.get(item.sourceId)?.type));
      if (!eligible.length) issue(errors, "power30min.ineligible_source", `${field} requires exact verified regulatory/approval/official technical-document evidence`, { entityId: variant.id, field });
    }
  }
  for (const media of data.records.media) {
    const source = indexes.sources.get(media.sourceId);
    if (!source) issue(errors, "media.source_missing", "Media references an unknown source", { entityId: media.id, sourceId: media.sourceId });
    const ownerIndex = media.ownerType === "brand" ? indexes.brands : media.ownerType === "model" ? indexes.models : media.ownerType === "generation" ? indexes.generations : indexes.facelifts;
    if (!ownerIndex.has(media.ownerId)) issue(errors, "media.owner_missing", "Media references an unknown owner", { entityId: media.id, ownerId: media.ownerId });
    if (!validDate(media.verifiedAt)) issue(errors, "media.verified_at", "Media verifiedAt must be a real YYYY-MM-DD date", { entityId: media.id });
  }

  const aliasCandidates = [
    ...data.records.brand.flatMap((row) => aliasRows(row, "brand", indexes)),
    ...data.records.model.flatMap((row) => aliasRows(row, "model", indexes)),
  ];
  const aliasGroups = new Map();
  for (const row of aliasCandidates.filter((item) => item.safe)) {
    const scope = row.entityType === "brand" ? "global" : row.brandId;
    const key = `${row.entityType}:${scope}:${row.normalized}`;
    const list = aliasGroups.get(key) || [];
    list.push(row);
    aliasGroups.set(key, list);
  }
  const collisions = [...aliasGroups.entries()].map(([key, rows]) => ({ key, rows, entityIds: [...new Set(rows.map((row) => row.entityId))] }))
    .filter((group) => group.entityIds.length > 1)
    .sort((left, right) => left.key.localeCompare(right.key));
  for (const collision of collisions) issue(errors, "alias.safe_collision", "Safe alias resolves to multiple canonical entities", { key: collision.key, entityIds: collision.entityIds });

  const duplicateGroups = new Map();
  for (const row of aliasCandidates) {
    const scope = row.entityType === "brand" ? "global" : row.brandId;
    const key = `${row.entityType}:${scope}:${row.normalized}`;
    const list = duplicateGroups.get(key) || [];
    list.push(row);
    duplicateGroups.set(key, list);
  }
  const duplicateAliasClusters = [...duplicateGroups.entries()]
    .map(([key, rows]) => ({ key, rows, entityIds: [...new Set(rows.map((row) => row.entityId))].sort() }))
    .filter((group) => group.entityIds.length > 1)
    .sort((left, right) => left.key.localeCompare(right.key));

  const conflicts = [];
  for (const type of ["brand", "model", "generation", "facelift", "variant"]) {
    for (const entity of data.records[type]) for (const item of entity.evidence || []) {
      if (item.status !== "verified") conflicts.push({ entityType: type, entityId: entity.id, sourceId: item.sourceId, fields: item.fields, status: item.status, note: item.note || null });
    }
  }

  const missingFields = data.records.variant.map((variant) => {
    const expected = [...RECOMMENDED_VARIANT_FIELDS];
    if (["BEV", "PHEV", "EREV", "FCEV"].includes(variant.powertrainKind)) {
      expected.push("motorPeakKw", "rangeStandard", "acChargeKw", "dcChargeKw");
      if (!isPresent(variant.power30MinKw) && !isPresent(variant.power30MinKwByMotor)) expected.push("power30MinKw");
      if (![variant.batteryGrossKwh, variant.batteryUsableKwh, variant.batteryRatedKwh].some(isPresent)) expected.push("batteryCapacityKwh");
      if (!isPresent(variant.rangeKm) && !(isPresent(variant.rangeKmMin) && isPresent(variant.rangeKmMax))) expected.push("rangeKmOrInterval");
    }
    if (["ICE", "MHEV", "HEV", "PHEV", "EREV"].includes(variant.powertrainKind)) expected.push("engineCc");
    return { entityId: variant.id, missing: [...new Set(expected)].filter((field) => ["batteryCapacityKwh", "rangeKmOrInterval"].includes(field) || !isPresent(variant[field])) };
  }).filter((row) => row.missing.length);

  const electrified = data.records.variant.filter((row) => ["BEV", "PHEV", "EREV", "FCEV"].includes(row.powertrainKind));
  const power30Documented = electrified.filter((row) => isPresent(row.power30MinKw) || isPresent(row.power30MinKwByMotor));
  const power30Report = {
    generatedFrom: "vehicle-encyclopedia-v2 canonical chunks",
    rule: "Exact documented value only; never derived from peak power.",
    eligibleVariants: electrified.length,
    documentedVariants: power30Documented.length,
    missingVariants: electrified.filter((row) => !isPresent(row.power30MinKw) && !isPresent(row.power30MinKwByMotor)).map((row) => row.id),
    coveragePercent: electrified.length ? Math.round((power30Documented.length / electrified.length) * 10000) / 100 : 0,
  };

  const brandCounts = new Map(data.records.brand.map((brand) => [brand.id, { brandId: brand.id, brand: brand.canonicalName, models: 0, generations: 0, facelifts: 0, variants: 0, media: 0 }]));
  for (const type of ["model", "generation", "facelift", "variant", "media"]) {
    for (const entity of data.records[type]) {
      let brandId = brandForEntity(entity, indexes);
      if (type === "media") {
        if (entity.ownerType === "brand") brandId = entity.ownerId;
        if (entity.ownerType === "model") brandId = indexes.models.get(entity.ownerId)?.brandId || null;
        if (entity.ownerType === "generation") brandId = brandForEntity(indexes.generations.get(entity.ownerId) || {}, indexes);
        if (entity.ownerType === "facelift") {
          const generationId = indexes.facelifts.get(entity.ownerId)?.generationId;
          brandId = brandForEntity(indexes.generations.get(generationId) || {}, indexes);
        }
      }
      const row = brandCounts.get(brandId);
      if (row) row[type === "media" ? "media" : `${type}s`] += 1;
    }
  }
  const coverage = {
    schemaVersion: 2,
    productionConnected: false,
    totals: Object.fromEntries(ENTITY_TYPES.map((type) => [type, data.records[type].length])),
    statuses: Object.fromEntries(ENTITY_TYPES.filter((type) => type !== "source" && type !== "media").map((type) => [type, countBy(data.records[type], (row) => row.status)])),
    byBrand: [...brandCounts.values()].sort((left, right) => left.brand.localeCompare(right.brand, "en")),
    sources: {
      byType: countBy(data.records.source, (row) => row.type),
      byDomain: countBy(data.records.source, sourceDomain),
    },
    chunks: data.chunks.map(({ file, chunk }) => ({ file, entityType: chunk.entityType, records: chunk.records.length, maxRecords: chunk.maxRecords })),
  };

  const reports = {
    coverage,
    aliasCollisions: { collisions },
    duplicateAliasClusters: { clusters: duplicateAliasClusters },
    sourceConflicts: { conflicts },
    missingFields: { variants: missingFields },
    power30MinCoverage: power30Report,
  };

  if (writeReports) {
    const reportsDir = path.join(root, "reports");
    await mkdir(reportsDir, { recursive: true });
    await writeJson(path.join(reportsDir, "coverage.json"), coverage);
    await writeJson(path.join(reportsDir, "alias-collisions.json"), reports.aliasCollisions);
    await writeJson(path.join(reportsDir, "duplicate-alias-clusters.json"), reports.duplicateAliasClusters);
    await writeJson(path.join(reportsDir, "source-conflicts.json"), reports.sourceConflicts);
    await writeJson(path.join(reportsDir, "missing-fields.json"), reports.missingFields);
    await writeJson(path.join(reportsDir, "power30min-coverage.json"), reports.power30MinCoverage);

    const manifestFile = path.join(root, "manifest.json");
    const manifest = await readJson(manifestFile);
    for (const type of ENTITY_TYPES) {
      manifest.collections[type].chunks = data.chunks.filter(({ chunk }) => chunk.entityType === type).length;
      manifest.collections[type].records = data.records[type].length;
    }
    manifest.inProgressBrands = data.records.brand.filter((row) => row.status !== "verified").map((row) => row.canonicalName);
    manifest.completedBrands = data.records.brand.filter((row) => row.status === "verified").map((row) => row.canonicalName);
    manifest.lastCheckpoint = [...allIds.keys()].length ? [...data.records.brand, ...data.records.model, ...data.records.generation, ...data.records.facelift, ...data.records.variant].map((row) => row.updatedAt).filter(Boolean).sort().at(-1) || null : null;
    manifest.status = errors.length
      ? "invalid"
      : data.records.brand.some((row) => row.status !== "verified")
        ? "checkpoint-seed"
        : data.records.model.length
          ? "pilot-seed"
          : "foundation";
    await writeJson(manifestFile, manifest);
  }

  return { errors, warnings, reports, data };
}

async function main() {
  const writeReports = process.argv.includes("--write-reports");
  const result = await validateWorkspace({ writeReports });
  console.log(JSON.stringify({ valid: result.errors.length === 0, errors: result.errors, warnings: result.warnings, totals: result.reports.coverage.totals }, null, 2));
  if (result.errors.length) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
