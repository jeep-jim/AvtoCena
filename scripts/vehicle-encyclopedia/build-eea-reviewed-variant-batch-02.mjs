import { readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { WORKSPACE_ROOT, loadWorkspace, readJson, writeJson } from "./lib.mjs";

const INPUT_DIR = path.join(WORKSPACE_ROOT, "reports/model-eea-europe-2020-2025");
const REPORT_FILE = path.join(WORKSPACE_ROOT, "reports/variant-eea-reviewed-02.json");
const INGEST_FILE = path.join(WORKSPACE_ROOT, "ingest/variants-eea-reviewed-02-2026-08-17.json");
const OBSERVATION_BODY_TYPE = "Passenger car";

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

function specificationKey(generationId, candidate, fuel) {
  return [
    generationId,
    fuelKey(fuel),
    candidate.engineCc ?? "",
    candidate.powerKw ?? "",
    candidate.yearFrom,
    candidate.yearTo ?? "",
  ].join("|");
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

function observationGenerationId(modelId) {
  return `${modelId}/eea-registration-observations-2020-2025`;
}

function generationContains(generation, candidate) {
  const from = year(generation.productionFrom);
  const to = year(generation.productionTo);
  return (from === null || candidate.yearFrom >= from) && (to === null || candidate.yearTo <= to);
}

async function loadModificationCandidates() {
  const files = (await readdir(INPUT_DIR)).filter((file) => /^modifications-\d{4}\.json$/.test(file)).sort();
  const rows = [];
  for (const file of files) rows.push(...(await readJson(path.join(INPUT_DIR, file))).records);
  return rows;
}

export async function buildEeaReviewedVariantBatch02({ verifiedAt = "2026-08-17" } = {}) {
  const [workspace, candidates] = await Promise.all([loadWorkspace(), loadModificationCandidates()]);
  const models = new Map(workspace.records.model.map((model) => [model.id, model]));
  const sources = new Map(workspace.records.source.map((source) => [source.id, source]));
  const generationsByModel = new Map();
  for (const generation of workspace.records.generation) {
    const rows = generationsByModel.get(generation.modelId) || [];
    rows.push(generation);
    generationsByModel.set(generation.modelId, rows);
  }
  const previouslyPromotedCandidateIds = new Set(workspace.records.variant.flatMap((variant) => {
    const match = variant.id.match(/(eea-mod-[a-f0-9]+)$/);
    return match ? [match[1]] : [];
  }));
  const existingKeys = new Set(workspace.records.variant.map(existingSpecificationKey));
  const updatedSources = workspace.records.source
    .filter((source) => /^src-eea-co2cars-/.test(source.id))
    .map((source) => ({
      ...source,
      supportedFields: [...new Set([
        ...source.supportedFields,
        "bodyType",
        "bodyTypes",
        "productionFrom",
      ])].sort(),
    }));

  const accepted = [];
  const observationCandidates = new Map();
  const rejected = {
    exactModelMissing: 0,
    candidateAlreadyPromoted: 0,
    ambiguousFuel: 0,
    emptyTechnicalIdentity: 0,
    noUniqueExistingGeneration: 0,
    duplicateExistingSpecification: 0,
    sourceMissing: 0,
  };

  for (const candidate of candidates) {
    const model = models.get(candidate.modelId);
    if (!model) {
      rejected.exactModelMissing += 1;
      continue;
    }
    if (previouslyPromotedCandidateIds.has(candidate.id)) {
      rejected.candidateAlreadyPromoted += 1;
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
    const existingGenerations = generationsByModel.get(candidate.modelId) || [];
    let generationId;
    let generationMode;
    if (!existingGenerations.length) {
      generationId = observationGenerationId(candidate.modelId);
      generationMode = "observation_container";
      const rows = observationCandidates.get(candidate.modelId) || [];
      rows.push(candidate);
      observationCandidates.set(candidate.modelId, rows);
    } else {
      const matches = existingGenerations.filter((generation) => generationContains(generation, candidate));
      if (matches.length !== 1) {
        rejected.noUniqueExistingGeneration += 1;
        continue;
      }
      generationId = matches[0].id;
      generationMode = "unique_existing_generation";
    }
    const key = specificationKey(generationId, candidate, fuel.fuel);
    if (existingKeys.has(key)) {
      rejected.duplicateExistingSpecification += 1;
      continue;
    }
    const sourceIds = candidate.sourceDatasetIds.map((id) => `src-${id}`).filter((id) => sources.has(id)).sort();
    if (!sourceIds.length) {
      rejected.sourceMissing += 1;
      continue;
    }
    accepted.push({ candidate, model, fuel, generationId, generationMode, sourceIds, key });
    existingKeys.add(key);
  }

  const generations = [];
  for (const [modelId, rows] of [...observationCandidates.entries()].sort(([left], [right]) => left.localeCompare(right, "en"))) {
    if (!accepted.some((item) => item.generationMode === "observation_container" && item.candidate.modelId === modelId)) continue;
    const sourceIds = [...new Set(rows.flatMap((candidate) => candidate.sourceDatasetIds.map((id) => `src-${id}`)).filter((id) => sources.has(id)))].sort();
    const firstYear = Math.min(...rows.map((candidate) => candidate.yearFrom));
    const lastYear = Math.max(...rows.map((candidate) => candidate.yearTo));
    generations.push({
      id: observationGenerationId(modelId),
      modelId,
      name: `${firstYear}-${lastYear} EEA registration observations`,
      aliases: [],
      platformCodes: [],
      productionFrom: String(firstYear),
      productionTo: null,
      bodyTypes: [OBSERVATION_BODY_TYPE],
      status: "review",
      evidence: sourceIds.map((sourceId) => ({
        sourceId,
        fields: ["name", "productionFrom", "bodyTypes"],
        status: "verified",
        confidence: "official",
        note: "This is an explicitly labelled EEA registration-observation container for passenger-car records, not a manufacturer generation claim. The productionFrom field is only the first observed registration year.",
      })),
      researchNotes: [
        "Temporary review-only container required by the V2 relation schema for exact EEA modification observations when no source-backed manufacturer generation exists yet.",
        "Never publish this record as a real vehicle generation; replace it with official generation evidence before the public encyclopedia gate.",
      ],
      updatedAt: verifiedAt,
    });
  }

  const variants = accepted.map(({ candidate, model, fuel, generationId, generationMode, sourceIds }) => {
    const evidenceFields = ["name", "market", "yearFrom", "yearTo", "bodyType", "fuel", "powertrainKind"];
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
    return {
      id: `${generationId}/${candidate.id}`,
      modelId: candidate.modelId,
      generationId,
      faceliftId: null,
      name: candidateName(model, candidate.commercialNames?.[0], fuel.fuel, candidate.engineCc, candidate.powerKw),
      aliases,
      market: "Europe",
      yearFrom: candidate.yearFrom,
      yearTo: candidate.yearTo,
      bodyType: OBSERVATION_BODY_TYPE,
      powertrainKind: fuel.powertrainKind,
      fuel: fuel.fuel,
      engineCc: candidate.engineCc,
      powerKw: candidate.powerKw,
      status: "review",
      evidence: sourceIds.map((sourceId) => ({
        sourceId,
        fields: evidenceFields,
        status: "verified",
        confidence: "official",
        note: "Exact grouped EEA new-passenger-car registration observation. Passenger car is the dataset class, not an inferred body style; source spellings remain unsafe aliases.",
      })),
      researchNotes: [
        `EEA grouped registration observation across ${candidate.specificationGroups} source specification group(s) and ${candidate.registrations} registration(s).`,
        generationMode === "observation_container"
          ? "Linked to an explicitly non-public EEA observation container because no source-backed manufacturer generation is staged yet."
          : "Linked only because exactly one staged generation contains the complete EEA observation year range.",
        "No trim, body style, transmission, drive, generation boundary, horsepower or 30-minute power is inferred from the EEA grouping.",
        "Review-only: this record cannot auto-resolve pricing until model/generation and source-name matching is separately approved.",
      ],
      updatedAt: verifiedAt,
    };
  }).sort((left, right) => left.id.localeCompare(right.id, "en"));

  const observationVariants = variants.filter((variant) => variant.generationId.includes("/eea-registration-observations-2020-2025"));
  const existingGenerationVariants = variants.length - observationVariants.length;
  const report = {
    schemaVersion: 2,
    generatedAt: verifiedAt,
    productionConnected: false,
    inputCandidates: candidates.length,
    acceptedVariants: variants.length,
    acceptedModels: new Set(variants.map((variant) => variant.modelId)).size,
    acceptedObservationContainers: generations.length,
    acceptedObservationContainerVariants: observationVariants.length,
    acceptedExistingGenerationVariants: existingGenerationVariants,
    representedRegistrations: accepted.reduce((sum, item) => sum + item.candidate.registrations, 0),
    rejected,
    policy: {
      priorityWindow: "Europe 2020-2025",
      exactExistingModelRequired: true,
      unambiguousFuelRequired: true,
      uniqueExistingGenerationYearContainmentRequired: true,
      missingGenerationsUseExplicitNonPublicObservationContainer: true,
      passengerCarIsDatasetClassNotBodyStyle: true,
      sourceNamesRemainUnsafe: true,
      automaticPublicationReady: false,
    },
    generationIds: generations.map((generation) => generation.id),
    variantIds: variants.map((variant) => variant.id),
  };
  return {
    report,
    ingestion: {
      schemaVersion: 2,
      batches: [
        ...chunks("source", updatedSources),
        ...chunks("generation", generations),
        ...chunks("variant", variants),
      ],
    },
  };
}

async function main() {
  const { report, ingestion } = await buildEeaReviewedVariantBatch02();
  await writeJson(REPORT_FILE, report);
  await writeJson(INGEST_FILE, ingestion);
  console.log(JSON.stringify({
    acceptedVariants: report.acceptedVariants,
    acceptedModels: report.acceptedModels,
    acceptedObservationContainers: report.acceptedObservationContainers,
    acceptedObservationContainerVariants: report.acceptedObservationContainerVariants,
    acceptedExistingGenerationVariants: report.acceptedExistingGenerationVariants,
    representedRegistrations: report.representedRegistrations,
    rejected: report.rejected,
  }, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
