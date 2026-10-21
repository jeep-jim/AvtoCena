import path from "node:path";
import { pathToFileURL } from "node:url";
import { WORKSPACE_ROOT, loadWorkspace, writeJson } from "./lib.mjs";

const REPORT_FILE = path.join(WORKSPACE_ROOT, "reports/model-europe-official-commercial-02.json");
const INGEST_FILE = path.join(WORKSPACE_ROOT, "ingest/models-europe-official-commercial-02-2026-08-17.json");

export async function buildEuropeOfficialCommercialModelBatch02({ verifiedAt = "2026-08-17" } = {}) {
  const workspace = await loadWorkspace();
  const source = {
    id: "src-renault-master-fourth-generation-2023",
    type: "manufacturer",
    title: "Renault official global media: fourth-generation Master",
    publisher: "Renault Group",
    url: "https://media.renault.com/nouveau-renault-master-un-souffle-nouveau-sur-les-utilitaires/",
    documentId: null,
    documentDate: "2023-12-01",
    verifiedAt,
    market: "Europe",
    language: "fr",
    supportedFields: ["canonicalName", "bodyTypes"],
    confidence: "official",
    status: "active",
    license: null,
    notes: "Renault's official newsroom identifies Master as its large-van model and explicitly describes the fourth generation. This identity-only batch does not infer production dates or technical configurations.",
  };
  const model = {
    id: "renault/master",
    brandId: "renault",
    canonicalName: "Master",
    slug: "master",
    aliases: [],
    sourceNames: [{ value: "New Renault Master", kind: "market_name", safe: true, language: "en", market: "Europe", sourceIds: [source.id] }],
    productionFrom: null,
    productionTo: null,
    bodyTypes: ["Van"],
    powertrainKinds: [],
    mediaIds: [],
    status: "review",
    evidence: [{
      sourceId: source.id,
      fields: ["canonicalName", "bodyTypes"],
      status: "verified",
      confidence: "official",
      note: "Official Renault model-family and van-body identity; detailed configurations remain pending.",
    }],
    researchNotes: [
      "Priority-window identity seed for European 2020-2026 registration and listing normalization.",
      "Review status: exact generation dates, variants, canonical cover and complete technical specifications remain pending.",
    ],
    updatedAt: verifiedAt,
  };
  const sources = workspace.records.source.some((row) => row.id === source.id) ? [] : [source];
  const models = workspace.records.model.some((row) => row.id === model.id) ? [] : [model];
  const batches = [];
  if (sources.length) batches.push({ schemaVersion: 2, entityType: "source", chunk: 1, maxRecords: 250, records: sources });
  if (models.length) batches.push({ schemaVersion: 2, entityType: "model", chunk: 1, maxRecords: 250, records: models });
  return {
    report: {
      schemaVersion: 2,
      generatedAt: verifiedAt,
      productionConnected: false,
      totals: { reviewedDefinitions: 1, newModels: models.length, newSources: sources.length },
      modelIds: models.map((row) => row.id),
    },
    ingestion: { schemaVersion: 2, batches },
  };
}

async function main() {
  const { report, ingestion } = await buildEuropeOfficialCommercialModelBatch02();
  await writeJson(REPORT_FILE, report);
  await writeJson(INGEST_FILE, ingestion);
  console.log(JSON.stringify(report.totals, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
