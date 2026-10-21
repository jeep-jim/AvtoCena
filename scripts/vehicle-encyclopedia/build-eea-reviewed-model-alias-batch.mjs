import { readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { WORKSPACE_ROOT, loadWorkspace, normalizeTerm, readJson, writeJson } from "./lib.mjs";

const EEA_REPORT_DIR = path.join(WORKSPACE_ROOT, "reports/model-eea-europe-2020-2025");
const REPORT_FILE = path.join(WORKSPACE_ROOT, "reports/model-eea-reviewed-source-aliases.json");
const INGEST_FILE = path.join(WORKSPACE_ROOT, "ingest/models-eea-reviewed-source-aliases-2026-08-17.json");

const REVIEWED_SOURCE_NAMES = new Map([
  ["alfa-romeo/giulietta", ["ALFA GIULIETTA"]],
  ["bmw/2-series", ["218I", "218I ACTIVE TOURER", "218d Active Tourer", "225E XDRIVE ACTIVE TOURER", "220I", "220i Active Tourer", "218d"]],
  ["bmw/4-series", ["420I", "420D", "M440I XDRIVE", "420d xDrive"]],
  ["bmw/5-series", ["520D", "520d xDrive", "530E", "530E XDRIVE", "540d xDrive", "530D XDRIVE", "520I"]],
  ["lexus/es", ["LEXUS ES300H"]],
  ["lexus/nx", ["LEXUS NX350H", "LEXUS NX300H", "LEXUS NX450H+"]],
  ["lexus/ux", ["LEXUS UX250H", "UX250H"]],
  ["mazda/mazda3", ["3"]],
  ["mercedes-benz/e-class", ["E 220 D", "E 300 DE", "E 300 DE 4MATIC", "E 300E", "E 220 D 4MATIC", "E 200", "E 200 D"]],
  ["mercedes-benz/v-class", ["V KLASSE"]],
  ["mini/jcw", ["JOHN COOPER WORKS"]],
  ["peugeot/208", ["N208"]],
  ["peugeot/2008", ["N 2008"]],
  ["peugeot/3008", ["N 3008"]]
]);

function sourceIdsForYears(years) {
  const ids = new Set();
  for (const year of years) {
    if (year <= 2022) ids.add("src-eea-co2cars-2020-2022-final");
    else if (year === 2023) ids.add("src-eea-co2cars-2023-final");
    else if (year === 2024) ids.add("src-eea-co2cars-2024-provisional");
    else if (year === 2025) ids.add("src-eea-co2cars-2025-provisional");
  }
  return [...ids].sort();
}

function chunk(entityType, records) {
  return Array.from({ length: Math.ceil(records.length / 250) }, (_, index) => ({
    schemaVersion: 2,
    entityType,
    chunk: index + 1,
    maxRecords: 250,
    records: records.slice(index * 250, (index + 1) * 250)
  }));
}

async function loadUnmatchedRows() {
  const files = (await readdir(EEA_REPORT_DIR)).filter((file) => /^unmatched-commercial-names-\d+\.json$/.test(file)).sort();
  const rows = [];
  for (const file of files) rows.push(...(await readJson(path.join(EEA_REPORT_DIR, file))).records);
  return rows;
}

export async function buildEeaReviewedModelAliasBatch({ verifiedAt = "2026-08-17" } = {}) {
  const [workspace, unmatchedRows] = await Promise.all([loadWorkspace(), loadUnmatchedRows()]);
  const modelById = new Map(workspace.records.model.map((model) => [model.id, model]));
  const updatedModels = [];
  const accepted = [];

  for (const [modelId, reviewedNames] of REVIEWED_SOURCE_NAMES) {
    const model = modelById.get(modelId);
    if (!model) throw new Error(`Missing reviewed model alias target ${modelId}`);
    const names = new Set(reviewedNames.map(normalizeTerm));
    const rows = unmatchedRows.filter((row) => row.brandId === model.brandId && names.has(normalizeTerm(row.commercialName)));
    const found = new Set(rows.map((row) => normalizeTerm(row.commercialName)));
    const missing = reviewedNames.filter((name) => !found.has(normalizeTerm(name)));
    if (missing.length) throw new Error(`No unmatched EEA observations remain for ${modelId}: ${missing.join(", ")}`);

    const sourceNames = [...(model.sourceNames || [])];
    const seen = new Set(sourceNames.map((sourceName) => normalizeTerm(sourceName.value)));
    for (const row of rows.sort((left, right) => left.commercialName.localeCompare(right.commercialName, "en", { numeric: true }))) {
      if (seen.has(normalizeTerm(row.commercialName))) continue;
      seen.add(normalizeTerm(row.commercialName));
      sourceNames.push({
        value: row.commercialName,
        kind: "source_spelling",
        safe: true,
        language: "en",
        market: "Europe",
        sourceIds: sourceIdsForYears(row.years || [])
      });
      accepted.push({
        modelId,
        canonicalName: model.canonicalName,
        sourceName: row.commercialName,
        years: row.years || [],
        registrations: row.registrations || 0,
        specificationGroups: row.specificationGroups || 0
      });
    }
    updatedModels.push({ ...model, sourceNames, updatedAt: verifiedAt });
  }

  updatedModels.sort((left, right) => left.id.localeCompare(right.id, "en", { numeric: true }));
  accepted.sort((left, right) => right.registrations - left.registrations || left.modelId.localeCompare(right.modelId, "en"));
  const report = {
    schemaVersion: 2,
    generatedAt: verifiedAt,
    productionConnected: false,
    policy: {
      exactRegisteredCommercialNamesOnly: true,
      manuallyReviewedCanonicalTarget: true,
      modelLevelResolutionOnly: true,
      trimPowertrainAndBodyLabelsRemainBelowModel: true,
      automaticPublicationReady: false
    },
    totals: {
      reviewedModels: REVIEWED_SOURCE_NAMES.size,
      acceptedSourceNames: accepted.length,
      observedRegistrations: accepted.reduce((sum, row) => sum + row.registrations, 0),
      observedSpecificationGroups: accepted.reduce((sum, row) => sum + row.specificationGroups, 0)
    },
    accepted
  };
  return { report, ingestion: { schemaVersion: 2, batches: chunk("model", updatedModels) } };
}

async function main() {
  const { report, ingestion } = await buildEeaReviewedModelAliasBatch();
  await writeJson(REPORT_FILE, report);
  await writeJson(INGEST_FILE, ingestion);
  console.log(JSON.stringify(report.totals, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
