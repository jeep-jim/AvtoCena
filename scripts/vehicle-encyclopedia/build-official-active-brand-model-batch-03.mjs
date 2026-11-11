import path from "node:path";
import { pathToFileURL } from "node:url";
import { WORKSPACE_ROOT, loadWorkspace, writeJson } from "./lib.mjs";

const REPORT_FILE = path.join(WORKSPACE_ROOT, "reports/brand-model-official-active-03.json");
const INGEST_FILE = path.join(WORKSPACE_ROOT, "ingest/brand-model-official-active-03-2026-08-17.json");

const DEFINITIONS = [
  {
    id: "jmev",
    canonicalName: "JMEV",
    countries: ["China"],
    aliases: [
      { value: "Jiangxi Jiangling Group Electric Vehicle", kind: "source_spelling", safe: true, language: "en", market: "Global" },
      { value: "江铃集团新能源", kind: "localized", safe: true, language: "zh", market: "China" },
    ],
    source: {
      id: "src-jmev-global-range-2026",
      title: "JMEV official global brand and model range",
      publisher: "Jiangxi Jiangling Group Electric Vehicle Co., Ltd.",
      url: "https://en.jmev.com/",
      language: "en",
    },
    models: ["EWIND", "ELIGHT", "EV3", "EV2"].map((canonicalName) => ({ canonicalName, bodyTypes: [], powertrainKinds: ["BEV"] })),
  },
  {
    id: "micro",
    canonicalName: "Micro",
    countries: ["Switzerland"],
    aliases: [
      { value: "Micro Mobility Systems", kind: "source_spelling", safe: true, language: "en", market: "Global" },
    ],
    source: {
      id: "src-micro-mobility-brand-2026",
      title: "Micro Mobility official company and Microlino identity page",
      publisher: "Micro Mobility Systems AG",
      url: "https://www.micro-mobility.com/en/experience-micro/micro-mobility/micro-mobility",
      language: "en",
    },
    models: [{ canonicalName: "Microlino", bodyTypes: [], powertrainKinds: [] }],
  },
  {
    id: "srm-shineray",
    canonicalName: "SRM Shineray",
    countries: ["China"],
    aliases: [
      { value: "SRM", kind: "market_name", safe: true, language: "en", market: "China" },
      { value: "Shineray", kind: "market_name", safe: true, language: "en", market: "Global" },
    ],
    source: {
      id: "src-shineray-srm-brand-range-2026",
      title: "Shineray Motors official SRM/Shineray brand and model range",
      publisher: "Shineray Group",
      url: "https://shineray.com/news/detail-103.html",
      language: "en",
    },
    models: [
      { canonicalName: "X30", bodyTypes: ["Minivan"], powertrainKinds: [] },
      { canonicalName: "X30 EV", bodyTypes: ["Minivan"], powertrainKinds: ["BEV"] },
      { canonicalName: "X30L", bodyTypes: ["Minivan"], powertrainKinds: [] },
      { canonicalName: "X30L EV", bodyTypes: ["Minivan"], powertrainKinds: ["BEV"] },
      { canonicalName: "E3", bodyTypes: ["Minivan"], powertrainKinds: ["BEV"] },
      { canonicalName: "E3L", bodyTypes: ["Minivan"], powertrainKinds: ["BEV"] },
      { canonicalName: "T1", bodyTypes: ["Mini truck"], powertrainKinds: [] },
      { canonicalName: "T1 EV", bodyTypes: ["Mini truck"], powertrainKinds: ["BEV"] },
      { canonicalName: "T3", bodyTypes: ["Mini truck"], powertrainKinds: [] },
      { canonicalName: "T3 EV", bodyTypes: ["Mini truck"], powertrainKinds: ["BEV"] },
      { canonicalName: "T3L EV", bodyTypes: ["Mini truck"], powertrainKinds: ["BEV"] },
      { canonicalName: "T5", bodyTypes: ["Mini truck"], powertrainKinds: [] },
      { canonicalName: "T5L EV", bodyTypes: ["Mini truck"], powertrainKinds: ["BEV"] },
      { canonicalName: "M3", bodyTypes: ["MPV"], powertrainKinds: [] },
      { canonicalName: "M7", bodyTypes: ["MPV"], powertrainKinds: [] },
    ],
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

export async function buildOfficialActiveBrandModelBatch03({ verifiedAt = "2026-08-17" } = {}) {
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
        type: "manufacturer",
        title: item.source.title,
        publisher: item.source.publisher,
        url: item.source.url,
        documentId: null,
        documentDate: null,
        verifiedAt,
        market: "Global",
        language: item.source.language,
        supportedFields: ["canonicalName", "countries", "bodyTypes", "powertrainKinds"],
        confidence: "official",
        status: "active",
        license: null,
        notes: "Official current brand/range page. Only explicit public English identities and explicitly listed vehicle categories or electric powertrains are retained.",
      });
    }
    if (!existingBrands.has(item.id)) {
      brands.push({
        id: item.id,
        canonicalName: item.canonicalName,
        slug: item.id,
        aliases: item.aliases.map((alias) => ({ ...alias, sourceIds: [item.source.id] })),
        countries: item.countries,
        status: "seed",
        evidence: [{
          sourceId: item.source.id,
          fields: ["canonicalName", "countries"],
          status: "verified",
          confidence: "official",
          note: "The official source establishes the active vehicle-brand identity, stable English/Latin public name and company origin.",
        }],
        researchNotes: [
          "An authentic archived logo candidate exists, but its original source trace is incomplete; it is not staged as publication-ready media.",
          "Identity remains isolated from production until logo rights and full model/generation review pass.",
        ],
        updatedAt: verifiedAt,
      });
    }
    for (const model of item.models) {
      const id = `${item.id}/${slug(model.canonicalName)}`;
      if (existingModels.has(id)) continue;
      const fields = ["canonicalName"];
      if (model.bodyTypes.length) fields.push("bodyTypes");
      if (model.powertrainKinds.length) fields.push("powertrainKinds");
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
          fields,
          status: "verified",
          confidence: "official",
          note: "The official current range explicitly lists this English model identity and any retained category/powertrain designation.",
        }],
        researchNotes: [
          "Active 2020-2026 identity checkpoint; no generation boundary, grade or unlisted technical value is inferred.",
          "Review status blocks automatic pricing and public encyclopedia publication.",
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
        priorityWindow: "Active global passenger/light-commercial ranges, 2020-2026",
        officialIdentitySourceRequired: true,
        technicalConfigurationsNotInferred: true,
        untracedLogoCandidatesRejected: true,
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
  const { report, ingestion } = await buildOfficialActiveBrandModelBatch03();
  await writeJson(REPORT_FILE, report);
  await writeJson(INGEST_FILE, ingestion);
  console.log(JSON.stringify(report.totals, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
