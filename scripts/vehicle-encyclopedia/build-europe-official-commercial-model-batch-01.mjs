import path from "node:path";
import { pathToFileURL } from "node:url";
import { WORKSPACE_ROOT, loadWorkspace, writeJson } from "./lib.mjs";

const REPORT_FILE = path.join(WORKSPACE_ROOT, "reports/model-europe-official-commercial-01.json");
const INGEST_FILE = path.join(WORKSPACE_ROOT, "ingest/models-europe-official-commercial-01-2026-08-17.json");

const DEFINITIONS = [
  {
    id: "citroen/jumper",
    canonicalName: "Jumper",
    sourceId: "src-citroen-jumpy-jumper-range-2023",
    sourceTitle: "Citroën official commercial range: new Berlingo Van, Jumpy and Jumper",
    publisher: "Stellantis N.V.",
    url: "https://www.media.stellantis.com/es-es/citroen/press/nuevos-berlingo-van-jumpy-y-jumper-citroen-introduce-su-gama-de-vehiculos-comerciales-en-una-nueva-era",
    language: "es",
    sourceNames: ["New Jumper", "ë-Jumper"],
  },
  {
    id: "citroen/jumpy",
    canonicalName: "Jumpy",
    sourceId: "src-citroen-jumpy-jumper-range-2023",
    sourceTitle: "Citroën official commercial range: new Berlingo Van, Jumpy and Jumper",
    publisher: "Stellantis N.V.",
    url: "https://www.media.stellantis.com/es-es/citroen/press/nuevos-berlingo-van-jumpy-y-jumper-citroen-introduce-su-gama-de-vehiculos-comerciales-en-una-nueva-era",
    language: "es",
    sourceNames: ["New Jumpy", "ë-Jumpy"],
  },
  {
    id: "fiat/ducato",
    canonicalName: "Ducato",
    sourceId: "src-fiat-ducato-official-2024",
    sourceTitle: "Fiat Professional official archive: Ducato 2024",
    publisher: "Stellantis N.V.",
    url: "https://www.media.stellantis.com/uk-en/fiat-professional/press/fiat-professional-ducato-wins-large-van-of-the-year-2024-at-the-company-car-and-van-awards",
    language: "en",
    sourceNames: ["FIAT Professional Ducato", "New Ducato"],
  },
  {
    id: "fiat/talento",
    canonicalName: "Talento",
    sourceId: "src-fiat-talento-my2020",
    sourceTitle: "Fiat Professional official archive: Talento MY2020",
    publisher: "Stellantis N.V.",
    url: "https://www.fiatprofessional.com/fiat-pro-world/new-talento-my-2020",
    language: "en",
    sourceNames: ["Talento MY2020"],
  },
  {
    id: "opel/vivaro",
    canonicalName: "Vivaro",
    sourceId: "src-vauxhall-vivaro-third-generation-2021",
    sourceTitle: "Vauxhall official archive: Vivaro twentieth anniversary",
    publisher: "Vauxhall Motors Limited",
    url: "https://www.vauxhall.co.uk/business/fleet/news/2021/vauxhall-vivaro-celebrates-20-birthday.html",
    language: "en",
    sourceNames: ["Vivaro-e", "Vivaro Electric"],
  },
  {
    id: "peugeot/boxer",
    canonicalName: "Boxer",
    sourceId: "src-peugeot-boxer-official-2026",
    sourceTitle: "Peugeot official UK model page: Boxer and E-Boxer",
    publisher: "Peugeot UK Limited",
    url: "https://www.peugeot.co.uk/models/peugeot-boxer.html",
    language: "en",
    sourceNames: ["E-Boxer"],
  },
  {
    id: "peugeot/partner",
    canonicalName: "Partner",
    sourceId: "src-peugeot-partner-official-2025",
    sourceTitle: "Peugeot official archive: Partner and E-Partner",
    publisher: "Stellantis N.V.",
    url: "https://www.media.stellantis.com/uk-en/peugeot/press/peugeot-announces-new-professional-plus-trim-level-for-partner-e-partner",
    language: "en",
    sourceNames: ["E-Partner"],
  },
  {
    id: "volkswagen/transporter",
    canonicalName: "Transporter",
    sourceId: "src-volkswagen-transporter-kombi-official-2026",
    sourceTitle: "Volkswagen Commercial Vehicles official model page: Transporter Kombi",
    publisher: "Volkswagen Commercial Vehicles UK",
    url: "https://www.volkswagen-vans.co.uk/en/new-vehicles/transporter-kombi.html",
    language: "en",
    sourceNames: ["Transporter Kombi", "Kombi"],
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

export async function buildEuropeOfficialCommercialModelBatch01({ verifiedAt = "2026-08-17" } = {}) {
  const workspace = await loadWorkspace();
  const existingModels = new Set(workspace.records.model.map((model) => model.id));
  const existingSources = new Set(workspace.records.source.map((source) => source.id));
  const stagedSources = new Map();
  const sources = [];
  const models = [];

  for (const definition of DEFINITIONS) {
    if (!existingSources.has(definition.sourceId) && !stagedSources.has(definition.sourceId)) {
      const source = {
        id: definition.sourceId,
        type: "manufacturer",
        title: definition.sourceTitle,
        publisher: definition.publisher,
        url: definition.url,
        documentId: null,
        documentDate: null,
        verifiedAt,
        market: "Europe",
        language: definition.language,
        supportedFields: ["canonicalName", "bodyTypes"],
        confidence: "official",
        status: "active",
        license: null,
        notes: "The official manufacturer source identifies the marketed model family and its van/combi range. Exact generation and production boundaries are not inferred.",
      };
      stagedSources.set(source.id, source);
      sources.push(source);
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
        safe: value !== "Kombi",
        language: definition.language,
        market: "Europe",
        sourceIds: [definition.sourceId],
      })),
      productionFrom: null,
      productionTo: null,
      bodyTypes: ["Van"],
      powertrainKinds: [],
      mediaIds: [],
      status: "review",
      evidence: [{
        sourceId: definition.sourceId,
        fields: ["canonicalName", "bodyTypes"],
        status: "verified",
        confidence: "official",
        note: "Official European manufacturer identity and commercial-vehicle body family; detailed body, generation and powertrain configurations remain separate review work.",
      }],
      researchNotes: [
        "Priority-window identity seed for European 2020-2026 registration and listing normalization.",
        "Review status: generation boundaries, exact variants, canonical cover and complete technical specifications remain pending.",
      ],
      updatedAt: verifiedAt,
    });
  }

  sources.sort((left, right) => left.id.localeCompare(right.id, "en"));
  models.sort((left, right) => left.id.localeCompare(right.id, "en"));
  const report = {
    schemaVersion: 2,
    generatedAt: verifiedAt,
    productionConnected: false,
    policy: {
      officialManufacturerIdentityRequired: true,
      inWindowMassMarketCommercialModelsFirst: true,
      productionYearsNotInferred: true,
      generationsAndVariantsNotInferred: true,
      automaticPublicationReady: false,
    },
    totals: {
      reviewedDefinitions: DEFINITIONS.length,
      newModels: models.length,
      newSources: sources.length,
    },
    modelIds: models.map((model) => model.id),
  };
  return { report, ingestion: { schemaVersion: 2, batches: [...chunks("source", sources), ...chunks("model", models)] } };
}

async function main() {
  const { report, ingestion } = await buildEuropeOfficialCommercialModelBatch01();
  await writeJson(REPORT_FILE, report);
  await writeJson(INGEST_FILE, ingestion);
  console.log(JSON.stringify(report.totals, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
