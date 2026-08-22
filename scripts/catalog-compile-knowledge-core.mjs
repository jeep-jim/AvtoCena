import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const SOURCE_ROOT = path.resolve(process.env.KNOWLEDGE_SOURCE_ROOT || "data/catalog/knowledge-source-snapshots");
const V2_ROOT = path.resolve(process.env.KNOWLEDGE_V2_ROOT || "data/catalog/vehicle-encyclopedia-v2/chunks");
const OUT_ROOT = path.resolve(process.env.KNOWLEDGE_CORE_ROOT || "data/catalog/knowledge-core");
const CHUNK_SIZE = Math.max(100, Math.min(1000, Number(process.env.KNOWLEDGE_CORE_CHUNK_SIZE || 500)));
const QUEUE_CHUNK_SIZE = Math.max(100, Math.min(1000, Number(process.env.KNOWLEDGE_CORE_QUEUE_CHUNK_SIZE || 500)));

const clean = (value) => String(value ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
const norm = (value) => clean(value).toLocaleLowerCase("en-US")
  .replace(/ё/g, "е").replace(/&/g, "and").replace(/\+/g, "plus")
  .replace(/[^a-z0-9\p{L}\p{N}]+/gu, "");
const positive = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
};
const sha256 = (value) => crypto.createHash("sha256").update(value).digest("hex");
const stable = (value) => JSON.stringify(value);
const unique = (values) => [...new Set((values || []).map(clean).filter(Boolean))].sort((a, b) => a.localeCompare(b, "en"));

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

async function listJson(root, pattern) {
  return (await fs.readdir(root)).filter((name) => pattern.test(name)).sort((a, b) => a.localeCompare(b, "en"));
}

async function readChunkRecords(root, pattern, expectedEntityType = null) {
  const rows = [];
  for (const name of await listJson(root, pattern)) {
    const payload = await readJson(path.join(root, name));
    if (!Array.isArray(payload?.records)) throw new Error(`knowledge_core_invalid_chunk:${name}`);
    if (expectedEntityType && payload.entityType !== expectedEntityType) {
      throw new Error(`knowledge_core_invalid_entity:${name}:${payload.entityType}`);
    }
    rows.push(...payload.records);
  }
  return rows;
}

async function writeChunks(directory, prefix, entityType, rows, size) {
  await fs.mkdir(directory, { recursive: true });
  const files = [];
  for (let offset = 0; offset < rows.length; offset += size) {
    const chunk = Math.floor(offset / size) + 1;
    const name = `${prefix}-${String(chunk).padStart(4, "0")}.json`;
    const payload = {
      schemaVersion: 1,
      entityType,
      chunk,
      maxRecords: size,
      records: rows.slice(offset, offset + size),
    };
    // Runtime chunks and repair queues are deliberately compact: the source
    // corpus already preserves the human-auditable pretty JSON evidence.
    await fs.writeFile(path.join(directory, name), `${JSON.stringify(payload)}\n`);
    files.push(name);
  }
  return files;
}

const sourcePolicy = {
  "eea-co2-passenger-cars": { authority: "official_regulatory", confidence: "official" },
  "us-epa-fueleconomy": { authority: "official_government", confidence: "official" },
  "canada-nrcan": { authority: "official_government", confidence: "official" },
  "mlit-japan-fuel-economy": { authority: "official_government", confidence: "official" },
  "miit-road-vehicle-products": { authority: "official_regulatory", confidence: "official" },
  "korea-energy-agency-efficiency": { authority: "official_government", confidence: "official" },
  "korea-jeju-registration-file": { authority: "official_registration_observation", confidence: "official" },
  "autohome-china": { authority: "marketplace_source", confidence: "source_exact" },
};

function normalizedFuel(value) {
  const text = clean(value).toLowerCase();
  if (!text) return null;
  if (/纯电|electricity|electric|bev|электро/.test(text)) return "Electric";
  if (/柴油|diesel|диз/.test(text)) return "Diesel";
  if (/汽油|gasoline|petrol|premium|regular|midgrade|бенз/.test(text)) return "Petrol";
  if (/氢|hydrogen|fcev|водород/.test(text)) return "Hydrogen";
  if (/插电|混合|hybrid|phev|hev|erev|гибрид/.test(text)) return "Hybrid";
  return clean(value);
}

function normalizedPowertrain(row) {
  const text = `${clean(row.powertrainKind)} ${clean(row.energy)} ${clean(row.fuel)}`.toLowerCase();
  if (/增程|range.?extender|erev|series.?hybrid/.test(text)) return "EREV";
  if (/插电|plug.?in|phev/.test(text)) return "PHEV";
  if (/纯电|electricity|electric|bev|электро/.test(text)) return "BEV";
  if (/混合|hybrid|hev|гибрид/.test(text)) return "HEV";
  if (/氢|hydrogen|fcev/.test(text)) return "FCEV";
  if (/柴油|diesel|汽油|gasoline|petrol|premium|regular|midgrade/.test(text)) return "ICE";
  return null;
}

function evidenceModelIdentity(row, family, masterByExactIdentity) {
  if (family === "global") {
    return row?.canonical?.modelId || masterByExactIdentity.get(`${norm(row.make)}:${norm(row.commercialName)}`) || null;
  }
  if (family === "western") {
    return masterByExactIdentity.get(`${norm(row.make)}:${norm(row.model)}`) || null;
  }
  const make = row.brandName ?? row.brandCn ?? row.make ?? row.manufacturer;
  const model = row.seriesName ?? row.typeApprovalCode ?? row.model ?? row.modelName;
  return masterByExactIdentity.get(`${norm(make)}:${norm(model)}`) || null;
}

function evidenceYear(row) {
  // A Korean first-registration observation is never relabelled as model year.
  if (String(row.yearBasis || "").toLowerCase().includes("first_registration")) return null;
  const value = Number(row.year ?? row.modelYear ?? 0);
  return Number.isInteger(value) && value >= 1886 && value <= 2100 ? value : null;
}

function directFacts(row) {
  const powertrainKind = normalizedPowertrain(row);
  const engineLiters = positive(row.engineLiters);
  const engineCc = positive(row.engineCc) || (engineLiters ? Math.round(engineLiters * 1000) : null);
  const directPowerKw = positive(row.powerKw);
  const systemPowerKw = positive(row.systemPowerKw);
  const motorTotalKw = positive(row.motorTotalKw);
  const enginePowerKw = positive(row.enginePowerKw);
  let powerKw = directPowerKw;
  if (!powerKw && systemPowerKw) powerKw = systemPowerKw;
  if (!powerKw && powertrainKind === "BEV" && motorTotalKw) powerKw = motorTotalKw;
  if (!powerKw && powertrainKind === "ICE" && enginePowerKw) powerKw = enginePowerKw;
  return {
    bodyType: clean(row.bodyType || row.vehicleClass) || null,
    powertrainKind,
    fuel: normalizedFuel(row.fuel || row.energy),
    engineCode: clean(row.engineCode) || null,
    engineCc,
    transmission: clean(row.transmission) || null,
    drive: clean(row.drive) || null,
    powerKw,
    icePowerKw: ["PHEV", "HEV", "EREV"].includes(powertrainKind) ? enginePowerKw : null,
    batteryKwh: positive(row.batteryKwh),
  };
}

const factFields = [
  "bodyType", "powertrainKind", "fuel", "engineCode", "engineCc",
  "transmission", "drive", "powerKw", "icePowerKw", "batteryKwh",
];

function exactEvidenceIdentity(row, modelId, year) {
  const sourceId = clean(row.sourceId) || "unknown";
  let discriminator = "";
  if (sourceId === "eea-co2-passenger-cars") {
    const homologation = [row.type, row.variant, row.version].map(clean).filter(Boolean);
    if (!homologation.length) return null;
    discriminator = homologation.join("|");
  } else if (sourceId === "us-epa-fueleconomy") {
    discriminator = [row.fullModel || row.model, row.engineLiters, row.drive, row.transmission, row.fuel].map(clean).join("|");
  } else if (sourceId === "canada-nrcan") {
    discriminator = [row.model, row.engineLiters, row.transmission, row.fuel].map(clean).join("|");
  } else if (sourceId === "autohome-china") {
    discriminator = clean(row.specId);
  } else if (sourceId === "mlit-japan-fuel-economy") {
    discriminator = [row.typeDesignation, row.engineCode].map(clean).filter(Boolean).join("|");
  } else if (sourceId === "korea-energy-agency-efficiency") {
    discriminator = [row.modelName, row.vehicleClass, row.fuel, row.transmission].map(clean).join("|");
  } else if (sourceId === "miit-road-vehicle-products") {
    discriminator = clean(row.cpid || row.typeApprovalCode);
  }
  if (!discriminator) return null;
  return `${sourceId}|${modelId}|${clean(row.market)}|${year || "no-model-year"}|${discriminator}`;
}

function directLabel(row) {
  return clean(row.title || row.fullModel || row.commercialName || row.seriesName || row.model || row.modelName || row.vehicleNameCn) || "Source observation";
}

function evidenceUrl(row) {
  return clean(row.sourceUrl || row.sourcePageUrl) || null;
}

function compareRecord(left, right) {
  return stable(left).localeCompare(stable(right), "en");
}

const completion = await readJson(path.join(SOURCE_ROOT, "completion-report.json"));
if (completion?.ready !== true || !Array.isArray(completion?.failures) || completion.failures.length) {
  throw new Error("knowledge_core_source_corpus_not_ready");
}
const masterRoot = path.join(SOURCE_ROOT, "master");
const denominatorRoot = path.join(SOURCE_ROOT, "denominator");
const masterManifest = await readJson(path.join(masterRoot, "manifest.json"));
if (masterManifest?.status !== "source_master_built" || Number(masterManifest?.counts?.models || 0) < 5000) {
  throw new Error("knowledge_core_source_master_invalid");
}

const v2Models = await readChunkRecords(V2_ROOT, /^models-\d+\.json$/, "model");
const v2ModelIds = new Set(v2Models.map((row) => clean(row.id)).filter(Boolean));
const masterModels = await readChunkRecords(masterRoot, /^models-\d+\.json$/, "source_master_model");

const masterByExactIdentity = new Map();
const canonicalGroups = new Map();
const unresolvedMake = [];
const unresolvedCanonicalModel = [];
const missingImage = [];
const canonicalTargetConflicts = [];

for (const row of masterModels) {
  const make = clean(row.make);
  const model = clean(row.model);
  const canonicalModelId = clean(row.canonical?.modelId);
  const exactKey = make && model ? `${norm(make)}:${norm(model)}` : "";
  if (!make) {
    unresolvedMake.push({
      sourceKey: clean(row.sourceKey),
      model,
      markets: unique(row.markets),
      sources: unique(row.sources),
      reason: "make_missing_from_source_evidence",
      provenance: { origins: unique(row.origins) },
    });
  }
  if (!canonicalModelId || !v2ModelIds.has(canonicalModelId)) {
    unresolvedCanonicalModel.push({
      sourceKey: clean(row.sourceKey),
      make: make || null,
      model,
      markets: unique(row.markets),
      sources: unique(row.sources),
      reason: !make ? "make_unresolved" : canonicalModelId ? "canonical_target_missing_from_v2" : "no_unique_v2_model_match",
      proposedCanonicalModelId: canonicalModelId || null,
      provenance: { origins: unique(row.origins) },
    });
  }
  if (!(Array.isArray(row.imageUrls) && row.imageUrls.some((url) => clean(url)))) {
    missingImage.push({
      sourceKey: clean(row.sourceKey),
      canonicalModelId: canonicalModelId && v2ModelIds.has(canonicalModelId) ? canonicalModelId : null,
      make: make || null,
      model,
      markets: unique(row.markets),
      sources: unique(row.sources),
      reason: "model_bound_image_url_missing",
    });
  }
  if (!canonicalModelId || !v2ModelIds.has(canonicalModelId)) continue;
  if (exactKey) {
    const existing = masterByExactIdentity.get(exactKey);
    if (existing && existing !== canonicalModelId) {
      canonicalTargetConflicts.push({
        kind: "canonical_identity_conflict",
        exactIdentity: exactKey,
        canonicalModelIds: [existing, canonicalModelId].sort(),
        disposition: "withheld_from_runtime",
      });
      masterByExactIdentity.delete(exactKey);
    } else if (!canonicalTargetConflicts.some((item) => item.exactIdentity === exactKey)) {
      masterByExactIdentity.set(exactKey, canonicalModelId);
    }
  }
  const group = canonicalGroups.get(canonicalModelId) || [];
  group.push(row);
  canonicalGroups.set(canonicalModelId, group);
}

const evidenceFamilies = [
  { family: "global", pattern: /^variant-evidence-\d+\.json$/ },
  { family: "western", pattern: /^western-variant-evidence-\d+\.json$/ },
  { family: "asia", pattern: /^asia-variant-evidence-\d+\.json$/ },
];
const evidenceFiles = [];
for (const item of evidenceFamilies) {
  for (const name of await listJson(denominatorRoot, item.pattern)) evidenceFiles.push({ ...item, name });
}

const identityState = new Map();
let evidenceRows = 0;
let canonicallyLinkedEvidence = 0;
let linkedWithoutModelYear = 0;
for (const file of evidenceFiles) {
  const payload = await readJson(path.join(denominatorRoot, file.name));
  for (const row of payload.records || []) {
    evidenceRows++;
    const modelId = evidenceModelIdentity(row, file.family, masterByExactIdentity);
    if (!modelId || !v2ModelIds.has(modelId)) continue;
    canonicallyLinkedEvidence++;
    const year = evidenceYear(row);
    if (!year) linkedWithoutModelYear++;
    const identityKey = exactEvidenceIdentity(row, modelId, year);
    if (!identityKey) continue;
    const facts = directFacts(row);
    const current = identityState.get(identityKey) || { values: {}, conflicts: {}, modelId, sourceId: clean(row.sourceId), market: clean(row.market), year };
    for (const field of factFields) {
      const value = facts[field];
      if (value === null || value === undefined || value === "") continue;
      const fingerprint = stable(value);
      if (!current.values[field]) {
        current.values[field] = { fingerprint, value, evidenceId: clean(row.evidenceId) };
      } else if (current.values[field].fingerprint !== fingerprint) {
        const values = current.conflicts[field] || new Map([[current.values[field].fingerprint, {
          value: current.values[field].value,
          evidenceIds: [current.values[field].evidenceId].filter(Boolean),
        }]]);
        const existing = values.get(fingerprint) || { value, evidenceIds: [] };
        if (existing.evidenceIds.length < 10 && row.evidenceId) existing.evidenceIds.push(clean(row.evidenceId));
        values.set(fingerprint, existing);
        current.conflicts[field] = values;
      }
    }
    identityState.set(identityKey, current);
  }
}

const conflictFieldsByIdentity = new Map();
const sourceConflicts = [...canonicalTargetConflicts];
const sourceConflictCountsByModel = new Map();
for (const [identityKey, state] of identityState) {
  const fields = Object.keys(state.conflicts).sort();
  if (!fields.length) continue;
  conflictFieldsByIdentity.set(identityKey, new Set(fields));
  sourceConflictCountsByModel.set(state.modelId, (sourceConflictCountsByModel.get(state.modelId) || 0) + fields.length);
  for (const field of fields) {
    sourceConflicts.push({
      kind: "source_fact_conflict",
      canonicalModelId: state.modelId,
      sourceId: state.sourceId,
      market: state.market || null,
      modelYear: state.year,
      exactEvidenceIdentity: identityKey,
      field,
      values: [...state.conflicts[field].values()].sort(compareRecord),
      disposition: "field_withheld_from_runtime",
    });
  }
}

const variantGroups = new Map();
for (const file of evidenceFiles) {
  const payload = await readJson(path.join(denominatorRoot, file.name));
  for (const row of payload.records || []) {
    const modelId = evidenceModelIdentity(row, file.family, masterByExactIdentity);
    if (!modelId || !v2ModelIds.has(modelId)) continue;
    const year = evidenceYear(row);
    if (!year) continue;
    const market = clean(row.market).toLowerCase();
    if ((market === "japan" && year < 2010) || (market !== "japan" && year < 2020)) continue;
    const facts = directFacts(row);
    const identityKey = exactEvidenceIdentity(row, modelId, year);
    const conflicted = identityKey ? conflictFieldsByIdentity.get(identityKey) : null;
    for (const field of conflicted || []) facts[field] = null;
    const presentFields = factFields.filter((field) => facts[field] !== null && facts[field] !== undefined && facts[field] !== "");
    if (!presentFields.length) continue;
    const groupKey = stable([modelId, market, year, ...factFields.map((field) => facts[field] ?? null)]);
    const group = variantGroups.get(groupKey) || {
      modelId,
      market,
      year,
      facts,
      labels: new Set(),
      sources: new Map(),
      imageCandidates: new Map(),
    };
    group.labels.add(directLabel(row));
    const sourceId = clean(row.sourceId) || "unknown";
    const policy = sourcePolicy[sourceId] || { authority: "source_observation", confidence: "source_exact" };
    const source = group.sources.get(sourceId) || {
      sourceId,
      authority: policy.authority,
      confidence: policy.confidence,
      evidenceCount: 0,
      observationCount: 0,
      evidenceIds: [],
      sourceUrls: [],
      fields: new Set(),
    };
    source.evidenceCount++;
    source.observationCount += positive(row.observations) || 1;
    if (source.evidenceIds.length < 20 && row.evidenceId) source.evidenceIds.push(clean(row.evidenceId));
    const url = evidenceUrl(row);
    if (url && !source.sourceUrls.includes(url) && source.sourceUrls.length < 10) source.sourceUrls.push(url);
    presentFields.forEach((field) => source.fields.add(field));
    group.sources.set(sourceId, source);
    const imageUrl = clean(row.imageUrl);
    if (imageUrl) group.imageCandidates.set(imageUrl, { url: imageUrl, binaryVerified: false, sourceId });
    variantGroups.set(groupKey, group);
  }
}

const variants = [...variantGroups.values()].map((group) => {
  const idSeed = [group.modelId, group.market, group.year, ...factFields.map((field) => group.facts[field] ?? null)];
  const sourceEvidence = [...group.sources.values()].map((source) => ({
    sourceId: source.sourceId,
    authority: source.authority,
    evidenceCount: source.evidenceCount,
    observationCount: source.observationCount,
    evidenceIds: unique(source.evidenceIds),
    sourceUrls: unique(source.sourceUrls),
    fields: [...source.fields].sort(),
  })).sort((left, right) => left.sourceId.localeCompare(right.sourceId, "en"));
  return {
    id: `source/${sha256(stable(idSeed)).slice(0, 24)}`,
    modelId: group.modelId,
    name: [...group.labels].sort((a, b) => a.localeCompare(b, "en"))[0],
    market: group.market,
    yearFrom: group.year,
    yearTo: group.year,
    ...Object.fromEntries(factFields.map((field) => [field, group.facts[field]]).filter(([, value]) => value !== null && value !== undefined && value !== "")),
    status: "source_observed",
    evidence: [...group.sources.values()].map((source) => ({
      sourceId: source.sourceId,
      fields: [...source.fields].sort(),
      status: source.confidence === "official" ? "verified" : "observed",
      confidence: source.confidence,
    })).sort(compareRecord),
    provenance: {
      core: "knowledge-source-corpus",
      sourceEvidence,
      imageCandidates: [...group.imageCandidates.values()].sort(compareRecord),
    },
  };
}).sort((left, right) => left.id.localeCompare(right.id, "en"));

const compiledModels = [...canonicalGroups.entries()].map(([modelId, rows]) => {
  const first = rows[0];
  const imageMap = new Map();
  for (const row of rows) {
    for (const url of row.imageUrls || []) {
      const cleaned = clean(url);
      if (cleaned) imageMap.set(cleaned, { url: cleaned, binaryVerified: false, sourceKeys: [clean(row.sourceKey)] });
    }
  }
  return {
    id: modelId,
    canonicalBrandId: clean(first.canonical?.brandId) || modelId.split("/")[0],
    canonicalMake: clean(first.canonical?.canonicalMake),
    canonicalModel: clean(first.canonical?.canonicalModel),
    sourceIdentities: rows.map((row) => ({
      sourceKey: clean(row.sourceKey),
      make: clean(row.make),
      model: clean(row.model),
      markets: unique(row.markets),
      sources: unique(row.sources),
      origins: unique(row.origins),
      yearFrom: positive(row.yearFrom),
      yearTo: positive(row.yearTo),
    })).sort(compareRecord),
    imageCandidates: [...imageMap.values()].sort(compareRecord),
    imageBinaryVerified: false,
    sourceConflictCount: sourceConflictCountsByModel.get(modelId) || 0,
  };
}).sort((left, right) => left.id.localeCompare(right.id, "en"));

unresolvedMake.sort(compareRecord);
unresolvedCanonicalModel.sort(compareRecord);
missingImage.sort(compareRecord);
sourceConflicts.sort(compareRecord);

await fs.rm(OUT_ROOT, { recursive: true, force: true });
const chunksRoot = path.join(OUT_ROOT, "chunks");
const queuesRoot = path.join(OUT_ROOT, "queues");
const modelFiles = await writeChunks(chunksRoot, "models", "compiled_model", compiledModels, CHUNK_SIZE);
const variantFiles = await writeChunks(chunksRoot, "variants", "compiled_variant", variants, CHUNK_SIZE);
const queueFiles = {
  unresolvedMake: await writeChunks(queuesRoot, "unresolved-make", "unresolved_make", unresolvedMake, QUEUE_CHUNK_SIZE),
  unresolvedCanonicalModel: await writeChunks(queuesRoot, "unresolved-canonical-model", "unresolved_canonical_model", unresolvedCanonicalModel, QUEUE_CHUNK_SIZE),
  missingImage: await writeChunks(queuesRoot, "missing-image", "missing_image", missingImage, QUEUE_CHUNK_SIZE),
  sourceConflicts: await writeChunks(queuesRoot, "source-conflicts", "source_conflict", sourceConflicts, QUEUE_CHUNK_SIZE),
};

const contentDigest = sha256(stable({
  models: compiledModels.map((row) => [row.id, row.sourceIdentities.length, row.imageCandidates.length, row.sourceConflictCount]),
  variants: variants.map((row) => row.id),
  queues: {
    unresolvedMake,
    unresolvedCanonicalModel,
    missingImage,
    sourceConflicts,
  },
}));
const manifest = {
  schemaVersion: 1,
  id: "avtocena-production-knowledge-core",
  status: "ready",
  compiledAt: completion.builtAt || masterManifest.builtAt,
  compiler: "scripts/catalog-compile-knowledge-core.mjs",
  sourceCorpus: {
    ready: true,
    completionReport: "../knowledge-source-snapshots/completion-report.json",
    masterManifest: "../knowledge-source-snapshots/master/manifest.json",
    masterContentDigest: masterManifest.contentDigest,
    sourceBuiltAt: masterManifest.builtAt,
    chinaCoverage: "partial",
  },
  coverageContract: masterManifest.contract,
  counts: {
    sourceModels: masterModels.length,
    canonicalSourceModels: Number(masterManifest.counts.modelsWithCanonicalV2),
    compiledCanonicalModels: compiledModels.length,
    compiledSourceVariants: variants.length,
    evidenceRows,
    canonicallyLinkedEvidence,
    linkedWithoutModelYear,
    unresolvedMake: unresolvedMake.length,
    unresolvedCanonicalModel: unresolvedCanonicalModel.length,
    missingImage: missingImage.length,
    sourceConflicts: sourceConflicts.length,
  },
  files: {
    models: modelFiles.map((name) => `chunks/${name}`),
    variants: variantFiles.map((name) => `chunks/${name}`),
    queues: Object.fromEntries(Object.entries(queueFiles).map(([key, files]) => [key, files.map((name) => `queues/${name}`)])),
  },
  runtimeContract: {
    modelMatch: "Only a unique canonical V2 modelId stored in source master is compiled.",
    variantMatch: "Runtime still requires a unique year/market/spec match; ambiguous candidates are withheld.",
    factPromotion: "Only direct field-level official evidence may fill runtime facts. Marketplace observations remain provenance-only unless separately verified.",
    conflicts: "Conflicting values for the same exact source identity are removed field-by-field and emitted to source-conflicts.",
    koreaYear: "First-registration observation year is never compiled as model year.",
    image: "A model-bound image URL is only a candidate; binaryVerified remains false until the image file is downloaded and checked.",
    power30Min: "No 30-minute power field is emitted because the collected source corpus does not directly establish it.",
  },
  contentDigest,
};
await fs.writeFile(path.join(OUT_ROOT, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

console.log(JSON.stringify(manifest, null, 2));
const canonicalSourceModels = masterModels.filter((row) => row.canonical?.modelId && v2ModelIds.has(clean(row.canonical.modelId))).length;
if (canonicalSourceModels !== Number(masterManifest.counts.modelsWithCanonicalV2)) {
  throw new Error(`knowledge_core_canonical_source_count_mismatch:${canonicalSourceModels}:${masterManifest.counts.modelsWithCanonicalV2}`);
}
if (unresolvedMake.length !== masterModels.length - Number(masterManifest.counts.modelsWithKnownMake)) {
  throw new Error("knowledge_core_unresolved_make_count_mismatch");
}
if (unresolvedCanonicalModel.length !== masterModels.length - Number(masterManifest.counts.modelsWithCanonicalV2)) {
  throw new Error("knowledge_core_unresolved_canonical_count_mismatch");
}
if (missingImage.length !== masterModels.length - Number(masterManifest.counts.modelsWithImageUrl)) {
  throw new Error("knowledge_core_missing_image_count_mismatch");
}
if (!variants.length) throw new Error("knowledge_core_compiled_variants_empty");
