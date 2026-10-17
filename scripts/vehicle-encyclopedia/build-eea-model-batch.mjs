import { createHash } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { WORKSPACE_ROOT, loadWorkspace, normalizeTerm, readJson, writeJson } from "./lib.mjs";

const REPORT_FILE = path.join(WORKSPACE_ROOT, "reports/model-eea-canonical-intersection.json");
const INGEST_FILE = path.join(WORKSPACE_ROOT, "ingest/models-eea-canonical-intersection-2026-08-17.json");
const EEA_REPORT = path.join(WORKSPACE_ROOT, "reports/model-eea-europe-2020-2025.json");
const REVIEWED_VARIANT_LEVEL_IDENTITIES = new Set([
  "bugatti:chironpursport",
  "bugatti:chironsupersport",
]);

function slugify(value, fallback) {
  const slug = String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\+/g, " plus ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-");
  return slug || fallback;
}

function chunk(entityType, records) {
  return Array.from({ length: Math.ceil(records.length / 250) }, (_, index) => ({
    schemaVersion: 2,
    entityType,
    chunk: index + 1,
    maxRecords: 250,
    records: records.slice(index * 250, (index + 1) * 250),
  }));
}

function sourceId(datasetId) {
  return `src-${datasetId}`;
}

function datasetIdsForYears(years) {
  const ids = new Set();
  for (const year of years) {
    if (year <= 2022) ids.add("eea-co2cars-2020-2022-final");
    else if (year === 2023) ids.add("eea-co2cars-2023-final");
    else if (year === 2024) ids.add("eea-co2cars-2024-provisional");
    else if (year === 2025) ids.add("eea-co2cars-2025-provisional");
  }
  return [...ids].sort();
}

async function loadReportRecords(report, collectionName) {
  const rows = [];
  for (const file of report.collections[collectionName] || []) {
    const chunkValue = await readJson(path.join(WORKSPACE_ROOT, report.reportDirectory, file));
    rows.push(...chunkValue.records);
  }
  return rows;
}

export async function buildEeaModelBatch({ verifiedAt = "2026-08-17" } = {}) {
  const [workspace, eea] = await Promise.all([loadWorkspace(), readJson(EEA_REPORT)]);
  const intersections = await loadReportRecords(eea, "modelIntersections");
  const existingIdentities = new Set(workspace.records.model.map((model) => `${model.brandId}:${normalizeTerm(model.canonicalName)}`));
  const variantLevelCandidates = intersections.filter((row) => REVIEWED_VARIANT_LEVEL_IDENTITIES.has(`${row.brandId}:${normalizeTerm(row.canonicalName)}`));
  const candidates = intersections.filter((row) =>
    (row.disposition === "legacy_exact_candidate" || row.disposition === "legacy_prefix_candidate")
    && !existingIdentities.has(`${row.brandId}:${normalizeTerm(row.canonicalName)}`)
    && !REVIEWED_VARIANT_LEVEL_IDENTITIES.has(`${row.brandId}:${normalizeTerm(row.canonicalName)}`));
  const stagedModelsWithEeaEvidence = workspace.records.model.filter((model) =>
    (model.evidence || []).some((evidence) => evidence.sourceId.startsWith("src-eea-co2cars-")));
  const existingSourceIds = new Set(workspace.records.source.map((source) => source.id));
  const sources = eea.source.datasets.map((dataset) => ({
    id: sourceId(dataset.id),
    type: "government_registry",
    title: dataset.title,
    publisher: "European Environment Agency",
    url: dataset.url,
    documentId: dataset.table.replace(/[\[\]]/g, ""),
    documentDate: null,
    verifiedAt,
    market: "Europe",
    language: "en",
    supportedFields: ["canonicalName", "market", "yearFrom", "yearTo", "fuel", "engineCc", "powerKw"],
    confidence: "official",
    status: dataset.status === "provisional" ? "active" : "active",
    license: null,
    notes: `${dataset.status === "provisional" ? "Provisional" : "Final"} EEA passenger-car registration dataset. Commercial names and exact registered technical values are retained as observations; production and generation boundaries are not inferred.`,
  })).filter((source) => !existingSourceIds.has(source.id));

  const usedIds = new Set(workspace.records.model.map((model) => model.id));
  const usedSlugs = new Set(workspace.records.model.map((model) => `${model.brandId}:${model.slug}`));
  const models = [];
  for (const candidate of candidates.sort((left, right) => left.brandId.localeCompare(right.brandId, "en") || left.canonicalName.localeCompare(right.canonicalName, "en"))) {
    const identityKey = `${candidate.brandId}:${normalizeTerm(candidate.canonicalName)}`;
    const fallback = `eea-${createHash("sha256").update(identityKey).digest("hex").slice(0, 10)}`;
    let slug = slugify(candidate.canonicalName, fallback);
    let modelId = `${candidate.brandId}/${slug}`;
    if (usedIds.has(modelId) || usedSlugs.has(`${candidate.brandId}:${slug}`)) {
      slug = `${slug}-${createHash("sha256").update(identityKey).digest("hex").slice(0, 8)}`;
      modelId = `${candidate.brandId}/${slug}`;
    }
    usedIds.add(modelId);
    usedSlugs.add(`${candidate.brandId}:${slug}`);

    const datasetIds = datasetIdsForYears(candidate.years);
    const sourceIds = datasetIds.map(sourceId);
    const sourceNames = [...new Set(candidate.commercialNames)]
      .filter((name) => name !== candidate.canonicalName)
      .map((name) => ({
        value: name,
        kind: "source_spelling",
        safe: normalizeTerm(name) === normalizeTerm(candidate.canonicalName),
        language: "en",
        market: "Europe",
        sourceIds,
      }));
    models.push({
      id: modelId,
      brandId: candidate.brandId,
      canonicalName: candidate.canonicalName,
      slug,
      aliases: [],
      sourceNames,
      productionFrom: null,
      productionTo: null,
      bodyTypes: [],
      powertrainKinds: [],
      mediaIds: [],
      status: "review",
      evidence: sourceIds.map((id) => ({
        sourceId: id,
        fields: ["canonicalName"],
        status: "verified",
        confidence: "official",
        note: candidate.disposition === "legacy_exact_candidate"
          ? `Exact EEA commercial-name spelling intersects one same-brand VehiclesDB marketed-model candidate; observed in European registrations during ${candidate.years.join(", ")}.`
          : `The unique longest same-brand VehiclesDB marketed-model prefix separates the model from trim-rich EEA commercial-name text; observed in European registrations during ${candidate.years.join(", ")}.`,
      })),
      researchNotes: [
        `EEA source make spellings: ${candidate.sourceMakeNames.join(", ")}.`,
        `EEA registration observations: ${candidate.registrations}; specification groups: ${candidate.specificationGroups}. Counts establish observed presence, not total sales or production boundaries.`,
        "Review status: body style, powertrain family, generation boundary, canonical cover and complete marketed-model boundary remain unverified; excluded from safe automatic resolution.",
      ],
      updatedAt: verifiedAt,
    });
  }

  const report = {
    schemaVersion: 2,
    generatedAt: verifiedAt,
    productionConnected: false,
    policy: {
      exactNormalizedEeaToVehiclesDbIntersectionRequired: true,
      importedStatus: "review",
      safeAutomaticResolution: false,
      productionYearsInferred: false,
      generationInferred: false,
      completionClaimAllowed: false,
      reviewedVariantLevelIdentitiesExcluded: true,
    },
    totals: {
      eeaMatchedCanonicalModels: intersections.length,
      eeaExactCanonicalModels: intersections.filter((row) => row.disposition === "existing_model" || row.disposition === "legacy_exact_candidate").length,
      eeaPrefixMatchedCanonicalModels: intersections.filter((row) => row.disposition === "existing_model_prefix" || row.disposition === "legacy_prefix_candidate").length,
      existingModelIntersections: intersections.filter((row) => row.disposition === "existing_model").length,
      existingPrefixModelIntersections: intersections.filter((row) => row.disposition === "existing_model_prefix").length,
      newReviewModels: models.length,
      newExactReviewModels: models.filter((model) => intersections.find((row) => row.canonicalName === model.canonicalName && row.brandId === model.brandId)?.disposition === "legacy_exact_candidate").length,
      newPrefixReviewModels: models.filter((model) => intersections.find((row) => row.canonicalName === model.canonicalName && row.brandId === model.brandId)?.disposition === "legacy_prefix_candidate").length,
      stagedModelsWithEeaEvidence: stagedModelsWithEeaEvidence.length + models.length,
      brandsWithNewReviewModels: new Set(models.map((model) => model.brandId)).size,
      sources: sources.length,
      stagedModificationCandidates: eea.totals.exactModificationCandidates,
      variantLevelCandidatesExcluded: variantLevelCandidates.length,
    },
    byBrand: workspace.records.brand.map((brand) => ({
      brandId: brand.id,
      brand: brand.canonicalName,
      newReviewModels: models.filter((model) => model.brandId === brand.id).length,
      existingModelIntersections: intersections.filter((row) => row.brandId === brand.id && row.disposition === "existing_model").length,
    })).filter((row) => row.newReviewModels || row.existingModelIntersections),
    modelIds: models.map((model) => model.id),
    excludedVariantLevelIdentities: variantLevelCandidates.map((row) => ({
      brandId: row.brandId,
      canonicalName: row.canonicalName,
      disposition: row.disposition,
      registrations: row.registrations,
      reason: "reviewed derivative of a canonical model; retain as future variant/grade work instead of inflating the model count",
    })),
  };
  const eeaSourceIdSet = new Set(eea.source.datasets.map((dataset) => sourceId(dataset.id)));
  const snapshotSources = [...new Map([
    ...workspace.records.source.filter((source) => eeaSourceIdSet.has(source.id)),
    ...sources,
  ].map((source) => [source.id, source])).values()].sort((left, right) => left.id.localeCompare(right.id, "en"));
  const snapshotModels = [...stagedModelsWithEeaEvidence, ...models].sort((left, right) => left.id.localeCompare(right.id, "en"));
  const ingestion = {
    schemaVersion: 2,
    batches: [
      ...chunk("source", snapshotSources),
      ...chunk("model", snapshotModels),
    ],
  };
  return { report, ingestion };
}

async function main() {
  const { report, ingestion } = await buildEeaModelBatch();
  await writeJson(REPORT_FILE, report);
  await writeJson(INGEST_FILE, ingestion);
  console.log(JSON.stringify({ reportFile: REPORT_FILE, ingestFile: INGEST_FILE, totals: report.totals }, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
