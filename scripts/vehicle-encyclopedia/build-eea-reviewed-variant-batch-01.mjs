import { readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { WORKSPACE_ROOT, loadWorkspace, readJson, writeJson } from "./lib.mjs";

const INPUT_DIR = path.join(WORKSPACE_ROOT, "reports/model-eea-europe-2020-2025");
const REPORT_FILE = path.join(WORKSPACE_ROOT, "reports/variant-eea-reviewed-01.json");
const INGEST_FILE = path.join(WORKSPACE_ROOT, "ingest/variants-eea-reviewed-01-2026-08-17.json");

const ELIGIBLE_GENERATION_IDS = new Set([
  "abarth/500e/2022-launch",
  "alfa-romeo/junior/2024-launch",
  "aston-martin/db12/2023-launch",
  "audi/q6-e-tron/2024",
  "baic/x55/2022-global",
  "bentley/continental-gt/fourth-generation",
  "bmw/i4/g26",
  "byd/seal/2023",
  "citroen/c3/fourth-generation-europe",
  "geely/ex5/global",
  "honda/civic/11th-generation",
  "hyundai/tucson/fourth-generation",
  "lexus/rz/2022-launch",
  "mercedes-benz/glc/2022-launch",
  "porsche/taycan/2019-launch",
  "tesla/model-3/2024-series",
  "toyota/rav4/xa50",
  "volkswagen/golf/eighth-generation",
  "volvo/ex30/2023-launch",
]);

const FUEL_MAP = new Map([
  ["electric", { powertrainKind: "BEV", fuel: "Electric" }],
  ["petrol", { powertrainKind: "ICE", fuel: "Petrol" }],
  ["diesel", { powertrainKind: "ICE", fuel: "Diesel" }],
  ["lpg", { powertrainKind: "ICE", fuel: "LPG" }],
  ["ng", { powertrainKind: "ICE", fuel: "Natural gas" }],
  ["ng-biomethane", { powertrainKind: "ICE", fuel: "Natural gas / biomethane" }],
  ["e85", { powertrainKind: "ICE", fuel: "E85" }],
]);

function chunks(entityType, records) {
  return Array.from({ length: Math.ceil(records.length / 250) }, (_, index) => ({
    schemaVersion: 2,
    entityType,
    chunk: index + 1,
    maxRecords: 250,
    records: records.slice(index * 250, (index + 1) * 250),
  }));
}

function year(value) {
  return value ? Number(String(value).slice(0, 4)) : null;
}

function fuelKey(value) {
  return String(value || "").trim().toLowerCase();
}

function sameNumber(left, right) {
  if (left === null || left === undefined || right === null || right === undefined) return left == null && right == null;
  return Math.abs(Number(left) - Number(right)) < 0.11;
}

function existingSpecificationKey(variant) {
  return [
    variant.generationId,
    fuelKey(variant.fuel),
    variant.engineCc ?? "",
    variant.powerKw ?? "",
    variant.yearFrom,
    variant.yearTo ?? "",
  ].join("|");
}

function candidateName(model, sourceName, fuel, engineCc, powerKw) {
  const parts = [model.canonicalName, fuel];
  if (engineCc !== null) parts.push(`${engineCc} cc`);
  if (powerKw !== null) parts.push(`${powerKw} kW`);
  return `${sourceName || model.canonicalName} — ${parts.slice(1).join(" ")} (EEA registration group)`;
}

async function loadModificationCandidates() {
  const files = (await readdir(INPUT_DIR)).filter((file) => /^modifications-\d{4}\.json$/.test(file)).sort();
  const rows = [];
  for (const file of files) rows.push(...(await readJson(path.join(INPUT_DIR, file))).records);
  return rows;
}

export async function buildEeaReviewedVariantBatch01({ verifiedAt = "2026-08-17" } = {}) {
  const [workspace, candidates] = await Promise.all([loadWorkspace(), loadModificationCandidates()]);
  const generationByModel = new Map();
  for (const generation of workspace.records.generation) {
    const rows = generationByModel.get(generation.modelId) || [];
    rows.push(generation);
    generationByModel.set(generation.modelId, rows);
  }
  const modelById = new Map(workspace.records.model.map((model) => [model.id, model]));
  const sourceById = new Map(workspace.records.source.map((source) => [source.id, source]));
  const existingVariants = workspace.records.variant;
  const updatedSources = workspace.records.source
    .filter((source) => /^src-eea-co2cars-/.test(source.id))
    .map((source) => ({
      ...source,
      supportedFields: [...new Set([...source.supportedFields, "name", "powertrainKind"])].sort(),
    }));
  const existingIds = new Set(existingVariants.map((variant) => variant.id));
  const existingKeys = new Set(existingVariants.map(existingSpecificationKey));
  const variants = [];
  const rejected = {
    noUniqueEligibleGeneration: 0,
    outsideGenerationYears: 0,
    ambiguousFuel: 0,
    emptyTechnicalIdentity: 0,
    duplicateExistingSpecification: 0,
    bodyTypeEvidenceMissing: 0,
  };

  for (const candidate of candidates) {
    const generations = (generationByModel.get(candidate.modelId) || []).filter((generation) => ELIGIBLE_GENERATION_IDS.has(generation.id));
    if (generations.length !== 1) {
      rejected.noUniqueEligibleGeneration += 1;
      continue;
    }
    const generation = generations[0];
    const generationFrom = year(generation.productionFrom);
    const generationTo = year(generation.productionTo);
    if ((generationFrom !== null && candidate.yearFrom < generationFrom) || (generationTo !== null && candidate.yearTo > generationTo)) {
      rejected.outsideGenerationYears += 1;
      continue;
    }
    const fuel = FUEL_MAP.get(fuelKey(candidate.fuelSourceValue));
    if (!fuel) {
      rejected.ambiguousFuel += 1;
      continue;
    }
    if (candidate.engineCc === null && candidate.powerKw === null) {
      rejected.emptyTechnicalIdentity += 1;
      continue;
    }
    const duplicate = existingVariants.some((variant) => (
      variant.generationId === generation.id
      && fuelKey(variant.fuel) === fuelKey(fuel.fuel)
      && sameNumber(variant.engineCc, candidate.engineCc)
      && sameNumber(variant.powerKw, candidate.powerKw)
      && variant.yearFrom === candidate.yearFrom
      && (variant.yearTo ?? null) === (candidate.yearTo ?? null)
    ));
    const key = [generation.id, fuelKey(fuel.fuel), candidate.engineCc ?? "", candidate.powerKw ?? "", candidate.yearFrom, candidate.yearTo ?? ""].join("|");
    if (duplicate || existingKeys.has(key)) {
      rejected.duplicateExistingSpecification += 1;
      continue;
    }
    const model = modelById.get(candidate.modelId);
    if (!model) continue;
    const bodyEvidence = generation.evidence.find((item) => sourceById.get(item.sourceId)?.supportedFields.includes("bodyType"));
    if (!bodyEvidence) {
      rejected.bodyTypeEvidenceMissing += 1;
      continue;
    }
    const sourceIds = candidate.sourceDatasetIds.map((id) => `src-${id}`).filter((id) => sourceById.has(id)).sort();
    if (!sourceIds.length) continue;
    const evidenceFields = ["name", "market", "yearFrom", "yearTo", "fuel", "powertrainKind"];
    if (candidate.engineCc !== null) evidenceFields.push("engineCc");
    if (candidate.powerKw !== null) evidenceFields.push("powerKw");
    const aliases = [...new Set(candidate.commercialNames || [])]
      .filter((value) => value && value !== model.canonicalName)
      .sort((left, right) => left.localeCompare(right, "en"))
      .map((value) => ({
        value,
        kind: "source_spelling",
        safe: false,
        language: null,
        market: "Europe",
        sourceIds,
      }));
    const id = `${generation.id}/${candidate.id}`;
    if (existingIds.has(id)) continue;
    variants.push({
      id,
      modelId: candidate.modelId,
      generationId: generation.id,
      faceliftId: null,
      name: candidateName(model, candidate.commercialNames?.[0], fuel.fuel, candidate.engineCc, candidate.powerKw),
      aliases,
      market: "Europe",
      yearFrom: candidate.yearFrom,
      yearTo: candidate.yearTo,
      bodyType: generation.bodyTypes[0],
      powertrainKind: fuel.powertrainKind,
      fuel: fuel.fuel,
      engineCc: candidate.engineCc,
      powerKw: candidate.powerKw,
      status: "review",
      evidence: [
        ...sourceIds.map((sourceId) => ({
          sourceId,
          fields: evidenceFields,
          status: "verified",
          confidence: "official",
          note: "Exact grouped EEA passenger-car registration observation. The descriptive record name normalizes the source commercial name and exact source specifications; all source spellings remain unsafe aliases.",
        })),
        {
          sourceId: bodyEvidence.sourceId,
          fields: ["bodyType"],
          status: "verified",
          confidence: bodyEvidence.confidence,
          note: "Body type is retained from the separately reviewed generation source; it is not inferred from the EEA registration grouping.",
        },
      ],
      researchNotes: [
        `EEA grouped registration observation across ${candidate.specificationGroups} source specification group(s) and ${candidate.registrations} registration(s).`,
        "No trim, transmission, drive, generation boundary or 30-minute power is inferred from the EEA grouping.",
        "Review-only: this record cannot auto-resolve pricing until model/generation and source-name matching is separately approved.",
      ],
      updatedAt: verifiedAt,
    });
    existingKeys.add(key);
  }

  variants.sort((left, right) => left.id.localeCompare(right.id, "en"));
  const report = {
    schemaVersion: 2,
    generatedAt: verifiedAt,
    productionConnected: false,
    inputCandidates: candidates.length,
    eligibleGenerationIds: [...ELIGIBLE_GENERATION_IDS].sort(),
    acceptedVariants: variants.length,
    acceptedModels: new Set(variants.map((variant) => variant.modelId)).size,
    rejected,
    policy: {
      priorityWindow: "Europe 2020-2025",
      exactExistingModelRequired: true,
      uniqueReviewedGenerationRequired: true,
      generationYearContainmentRequired: true,
      ambiguousHybridFuelRejected: true,
      sourceNamesRemainUnsafe: true,
      automaticPublicationReady: false,
    },
    variantIds: variants.map((variant) => variant.id),
  };
  return { report, ingestion: { schemaVersion: 2, batches: [...chunks("source", updatedSources), ...chunks("variant", variants)] } };
}

async function main() {
  const { report, ingestion } = await buildEeaReviewedVariantBatch01();
  await writeJson(REPORT_FILE, report);
  await writeJson(INGEST_FILE, ingestion);
  console.log(JSON.stringify({ acceptedVariants: report.acceptedVariants, acceptedModels: report.acceptedModels, rejected: report.rejected }, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
