import path from "node:path";
import { pathToFileURL } from "node:url";
import { WORKSPACE_ROOT, loadWorkspace, writeJson } from "./lib.mjs";

const REPORT_FILE = path.join(WORKSPACE_ROOT, "reports/brand-model-russia-active-02.json");
const INGEST_FILE = path.join(WORKSPACE_ROOT, "ingest/brand-model-russia-active-02-2026-08-17.json");

const DEFINITIONS = [
  {
    id: "amberauto",
    canonicalName: "AMBERAUTO",
    aliases: [{ value: "АМБЕРАВТО", kind: "localized", safe: true, language: "ru", market: "Russia" }],
    source: {
      id: "src-amberauto-official-range-2026",
      title: "AMBERAUTO official current model range",
      publisher: "ATR Mobility LLC",
      url: "https://amberauto.ru/models",
      type: "manufacturer",
    },
    models: [{ canonicalName: "A5", bodyTypes: ["sedan"], powertrainKinds: ["BEV"] }],
  },
  {
    id: "ambertruck",
    canonicalName: "AMBERTRUCK",
    aliases: [{ value: "АМБЕРТРАК", kind: "localized", safe: true, language: "ru", market: "Russia" }],
    source: {
      id: "src-ambertruck-official-range-2026",
      title: "AMBERTRUCK official current model range",
      publisher: "AMBERTRUCK / AVTOTOR",
      url: "https://ambertruck.ru/models/",
      type: "manufacturer",
    },
    models: [
      { canonicalName: "JL", bodyTypes: ["truck"], powertrainKinds: ["ICE"] },
      { canonicalName: "JM", bodyTypes: ["truck"], powertrainKinds: ["ICE"] },
      { canonicalName: "SM", bodyTypes: ["truck"], powertrainKinds: ["ICE"] },
      { canonicalName: "EV 75", bodyTypes: ["truck"], powertrainKinds: ["BEV"] },
      { canonicalName: "EV 160", bodyTypes: ["truck"], powertrainKinds: ["BEV"] },
      { canonicalName: "WORK NF", bodyTypes: ["pickup"], powertrainKinds: ["ICE"] },
    ],
  },
  {
    id: "eonyx",
    canonicalName: "EONYX",
    aliases: [{ value: "EONY X", kind: "source_spelling", safe: true, language: "en", market: "Russia" }],
    source: {
      id: "src-eonyx-official-range-2026",
      title: "EONYX official current model range",
      publisher: "EONYX / AVTOTOR",
      url: "https://eonyx.ru/",
      type: "manufacturer",
    },
    models: [
      { canonicalName: "City", bodyTypes: ["microcar"], powertrainKinds: ["BEV"] },
      { canonicalName: "Cargo", bodyTypes: ["van"], powertrainKinds: ["BEV"] },
      { canonicalName: "Pickup", bodyTypes: ["pickup"], powertrainKinds: ["BEV"] },
    ],
  },
  {
    id: "nordcross",
    canonicalName: "Nordcross",
    aliases: [],
    source: {
      id: "src-nordcross-authorized-range-2026",
      title: "Nordcross authorized Russian dealer current model page",
      publisher: "Major Auto",
      url: "https://www.major-auto.ru/models/nordcross/001/",
      type: "authoritative_catalog",
    },
    models: [{ canonicalName: "001", bodyTypes: ["suv"], powertrainKinds: ["MHEV"] }],
  },
];

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function chunks(entityType, records) {
  return Array.from({ length: Math.ceil(records.length / 250) }, (_, index) => ({
    schemaVersion: 2,
    entityType,
    chunk: index + 1,
    maxRecords: 250,
    records: records.slice(index * 250, (index + 1) * 250),
  }));
}

export async function buildRussiaActiveBrandModelBatch02({ verifiedAt = "2026-08-17" } = {}) {
  const workspace = await loadWorkspace();
  const existingSources = new Set(workspace.records.source.map((source) => source.id));
  const existingBrands = new Set(workspace.records.brand.map((brand) => brand.id));
  const existingModels = new Set(workspace.records.model.map((model) => model.id));
  const sources = [];
  const brands = [];
  const models = [];

  for (const item of DEFINITIONS) {
    if (!existingSources.has(item.source.id)) {
      sources.push({
        id: item.source.id,
        type: item.source.type,
        title: item.source.title,
        publisher: item.source.publisher,
        url: item.source.url,
        documentId: null,
        documentDate: null,
        verifiedAt,
        market: "Russia",
        language: "ru",
        supportedFields: ["canonicalName", "countries", "bodyTypes", "powertrainKinds"],
        confidence: item.source.type === "manufacturer" ? "official" : "high",
        status: "active",
        license: null,
        notes: "Current official or brand-authorized range source. Only explicit public identities and vehicle categories are retained; no unlisted trims or technical values are inferred.",
      });
    }
    if (!existingBrands.has(item.id)) {
      brands.push({
        id: item.id,
        canonicalName: item.canonicalName,
        slug: item.id,
        aliases: item.aliases.map((alias) => ({ ...alias, sourceIds: [item.source.id] })),
        countries: ["Russia"],
        status: "seed",
        evidence: [{
          sourceId: item.source.id,
          fields: ["canonicalName", "countries"],
          status: "verified",
          confidence: item.source.type === "manufacturer" ? "official" : "high",
          note: "The source establishes this active Russian-market brand identity and its English/Latin public canonical name.",
        }],
        researchNotes: [
          "Authentic archived logo assets are staged at exactly 90 x 60; publication remains blocked pending rights review.",
          "Complete generation and grade coverage remains required before automatic pricing publication.",
        ],
        updatedAt: verifiedAt,
      });
    }
    for (const model of item.models) {
      const id = `${item.id}/${slug(model.canonicalName)}`;
      if (existingModels.has(id)) continue;
      models.push({
        id,
        brandId: item.id,
        canonicalName: model.canonicalName,
        slug: slug(model.canonicalName),
        aliases: [],
        sourceNames: [],
        productionFrom: null,
        productionTo: null,
        bodyTypes: model.bodyTypes,
        powertrainKinds: model.powertrainKinds,
        mediaIds: [],
        status: "review",
        evidence: [{
          sourceId: item.source.id,
          fields: ["canonicalName", "bodyTypes", "powertrainKinds"],
          status: "verified",
          confidence: item.source.type === "manufacturer" ? "official" : "high",
          note: "The official or brand-authorized page explicitly lists the model and its vehicle/powertrain category.",
        }],
        researchNotes: [
          "Priority-window identity for the Russian 2020-2026 market.",
          "Review status: generation boundaries, exact variants, canonical cover and complete technical specifications remain pending.",
        ],
        updatedAt: verifiedAt,
      });
    }
  }

  for (const rows of [sources, brands, models]) rows.sort((left, right) => left.id.localeCompare(right.id, "en"));
  return {
    report: {
      schemaVersion: 2,
      generatedAt: verifiedAt,
      productionConnected: false,
      policy: {
        priorityWindow: "Russia 2020-2026",
        officialOrBrandAuthorizedIdentityRequired: true,
        technicalConfigurationsNotInferred: true,
        logoAndRightsGateStillRequired: true,
        automaticPublicationReady: false,
      },
      totals: {
        reviewedBrands: DEFINITIONS.length,
        newSources: sources.length,
        newBrands: brands.length,
        newModels: models.length,
      },
      brandIds: DEFINITIONS.map((item) => item.id),
      modelIds: models.map((model) => model.id),
    },
    ingestion: {
      schemaVersion: 2,
      batches: [...chunks("source", sources), ...chunks("brand", brands), ...chunks("model", models)],
    },
  };
}

async function main() {
  const { report, ingestion } = await buildRussiaActiveBrandModelBatch02();
  await writeJson(REPORT_FILE, report);
  await writeJson(INGEST_FILE, ingestion);
  console.log(JSON.stringify(report.totals, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
