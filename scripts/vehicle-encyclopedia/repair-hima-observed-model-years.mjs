import path from "node:path";
import { pathToFileURL } from "node:url";
import { WORKSPACE_ROOT, loadWorkspace, writeJson } from "./lib.mjs";

const SOURCE_ID = "src-huawei-hicar-current-models-2026";
const REPORT_FILE = path.join(WORKSPACE_ROOT, "reports/hima-observed-model-year-repair.json");
const INGEST_FILE = path.join(WORKSPACE_ROOT, "ingest/hima-observed-model-year-repair-2026-08-17.json");
const MODEL_IDS = new Set([
  "aito/m5", "aito/m6", "aito/m7", "aito/m8",
  "luxeed/r7", "luxeed/s7", "luxeed/v9",
  "maextro/s800", "maextro/v680", "maextro/v800",
  "shangjie/h5", "shangjie/z7", "shangjie/z7t",
  "stelato/s9", "stelato/s9t",
]);

function chunk(entityType, records) {
  return { schemaVersion: 2, entityType, chunk: 1, maxRecords: 250, records };
}

export async function repairHimaObservedModelYears({ updatedAt = "2026-08-17" } = {}) {
  const workspace = await loadWorkspace();
  const source = workspace.records.source.find((record) => record.id === SOURCE_ID);
  if (!source) throw new Error(`${SOURCE_ID} is missing`);
  const repairedSource = {
    ...source,
    supportedFields: source.supportedFields.filter((field) => field !== "productionFrom"),
    notes: "Official Huawei compatibility inventory used for exact Chinese HIMA model names and priority-window observations. Compatibility model years are not treated as production start dates.",
  };
  const models = workspace.records.model.filter((model) => MODEL_IDS.has(model.id)).map((model) => ({
    ...model,
    productionFrom: null,
    evidence: model.evidence.map((item) => item.sourceId === SOURCE_ID ? {
      ...item,
      fields: item.fields.filter((field) => field !== "productionFrom"),
      note: "Huawei's official compatibility inventory explicitly lists this Chinese model identity inside the priority window; its compatibility year is not treated as a production start date.",
    } : item),
    researchNotes: [
      ...model.researchNotes.filter((note) => !note.includes("compatibility model years")),
      "Huawei compatibility model years are scope observations only and are not copied into productionFrom.",
    ],
    updatedAt,
  })).sort((left, right) => left.id.localeCompare(right.id, "en"));
  if (models.length !== MODEL_IDS.size) throw new Error(`Expected ${MODEL_IDS.size} HIMA models, found ${models.length}`);
  return {
    report: {
      schemaVersion: 2,
      generatedAt: updatedAt,
      productionConnected: false,
      repairedSource: SOURCE_ID,
      repairedModels: models.length,
      rule: "Compatibility model years prove in-window observation but never production start.",
      modelIds: models.map((model) => model.id),
    },
    ingestion: { schemaVersion: 2, batches: [chunk("source", [repairedSource]), chunk("model", models)] },
  };
}

async function main() {
  const { report, ingestion } = await repairHimaObservedModelYears();
  await writeJson(REPORT_FILE, report);
  await writeJson(INGEST_FILE, ingestion);
  console.log(JSON.stringify({ repairedSource: report.repairedSource, repairedModels: report.repairedModels }, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
