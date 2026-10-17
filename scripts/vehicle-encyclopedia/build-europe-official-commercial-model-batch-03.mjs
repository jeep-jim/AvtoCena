import path from "node:path";
import { pathToFileURL } from "node:url";
import { WORKSPACE_ROOT, loadWorkspace, writeJson } from "./lib.mjs";

const REPORT_FILE = path.join(WORKSPACE_ROOT, "reports/model-europe-official-commercial-03.json");
const INGEST_FILE = path.join(WORKSPACE_ROOT, "ingest/models-europe-official-commercial-03-2026-08-17.json");

const DEFINITIONS = [
  {
    id: "volkswagen/crafter",
    canonicalName: "Crafter",
    bodyTypes: ["Van"],
    sourceId: "src-volkswagen-crafter-official-2026",
    sourceTitle: "Volkswagen Commercial Vehicles official model page: Crafter panel van",
    publisher: "Volkswagen Commercial Vehicles UK",
    url: "https://www.volkswagen-vans.co.uk/en/new-vehicles/crafter-panel-van.html",
    sourceNames: ["Crafter panel van"],
  },
  {
    id: "vauxhall/combo-life",
    canonicalName: "Combo Life",
    bodyTypes: ["MPV"],
    sourceId: "src-vauxhall-combo-vivaro-life-official-2022",
    sourceTitle: "Vauxhall official archive: Combo Life and Vivaro Life electrification",
    publisher: "Vauxhall Motors Limited",
    url: "https://www.vauxhall.co.uk/discover/vauxhall-news/2022/01/vauxhall-accelerates-its-move-to-full-electrification.html",
    sourceNames: ["Combo-e Life", "Combo Life Electric"],
  },
  {
    id: "vauxhall/vivaro-life",
    canonicalName: "Vivaro Life",
    bodyTypes: ["MPV"],
    sourceId: "src-vauxhall-combo-vivaro-life-official-2022",
    sourceTitle: "Vauxhall official archive: Combo Life and Vivaro Life electrification",
    publisher: "Vauxhall Motors Limited",
    url: "https://www.vauxhall.co.uk/discover/vauxhall-news/2022/01/vauxhall-accelerates-its-move-to-full-electrification.html",
    sourceNames: ["Vivaro-e Life", "Vivaro Life Combi"],
  },
];

function chunks(entityType, records) {
  return Array.from({ length: Math.ceil(records.length / 250) }, (_, index) => ({
    schemaVersion: 2,
    entityType,
    chunk: index + 1,
    maxRecords: 250,
    records: records.slice(index * 250, (index + 1) * 250),
  }));
}

export async function buildEuropeOfficialCommercialModelBatch03({ verifiedAt = "2026-08-17" } = {}) {
  const workspace = await loadWorkspace();
  const existingModels = new Set(workspace.records.model.map((model) => model.id));
  const existingSources = new Set(workspace.records.source.map((source) => source.id));
  const sourcesById = new Map();
  const models = [];

  for (const definition of DEFINITIONS) {
    if (!existingSources.has(definition.sourceId) && !sourcesById.has(definition.sourceId)) {
      sourcesById.set(definition.sourceId, {
        id: definition.sourceId,
        type: "manufacturer",
        title: definition.sourceTitle,
        publisher: definition.publisher,
        url: definition.url,
        documentId: null,
        documentDate: null,
        verifiedAt,
        market: "Europe",
        language: "en",
        supportedFields: ["canonicalName", "bodyTypes"],
        confidence: "official",
        status: "active",
        license: null,
        notes: "Official manufacturer model-family identity only; generation boundaries and detailed configurations are not inferred.",
      });
    }
    if (existingModels.has(definition.id)) continue;
    models.push({
      id: definition.id,
      brandId: definition.id.split("/")[0],
      canonicalName: definition.canonicalName,
      slug: definition.id.split("/")[1],
      aliases: [],
      sourceNames: definition.sourceNames.map((value) => ({
        value,
        kind: "market_name",
        safe: true,
        language: "en",
        market: "Europe",
        sourceIds: [definition.sourceId],
      })),
      productionFrom: null,
      productionTo: null,
      bodyTypes: definition.bodyTypes,
      powertrainKinds: [],
      mediaIds: [],
      status: "review",
      evidence: [{
        sourceId: definition.sourceId,
        fields: ["canonicalName", "bodyTypes"],
        status: "verified",
        confidence: "official",
        note: "Official European manufacturer model-family and body identity; technical configurations remain pending.",
      }],
      researchNotes: [
        "Priority-window identity seed for European 2020-2026 registration and listing normalization.",
        "Review status: generation boundaries, exact variants, canonical cover and complete technical specifications remain pending.",
      ],
      updatedAt: verifiedAt,
    });
  }

  const sources = [...sourcesById.values()].sort((left, right) => left.id.localeCompare(right.id, "en"));
  models.sort((left, right) => left.id.localeCompare(right.id, "en"));
  return {
    report: {
      schemaVersion: 2,
      generatedAt: verifiedAt,
      productionConnected: false,
      policy: {
        officialManufacturerIdentityRequired: true,
        productionYearsNotInferred: true,
        generationsAndVariantsNotInferred: true,
        automaticPublicationReady: false,
      },
      totals: { reviewedDefinitions: DEFINITIONS.length, newModels: models.length, newSources: sources.length },
      modelIds: models.map((model) => model.id),
    },
    ingestion: { schemaVersion: 2, batches: [...chunks("source", sources), ...chunks("model", models)] },
  };
}

async function main() {
  const { report, ingestion } = await buildEuropeOfficialCommercialModelBatch03();
  await writeJson(REPORT_FILE, report);
  await writeJson(INGEST_FILE, ingestion);
  console.log(JSON.stringify(report.totals, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
