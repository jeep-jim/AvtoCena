import path from "node:path";
import { pathToFileURL } from "node:url";
import { WORKSPACE_ROOT, loadWorkspace, writeJson } from "./lib.mjs";

const REPORT_FILE = path.join(WORKSPACE_ROOT, "reports/brand-model-russia-active-01.json");
const INGEST_FILE = path.join(WORKSPACE_ROOT, "ingest/brand-model-russia-active-01-2026-08-17.json");

const DEFINITIONS = [
  {
    id: "evolute",
    canonicalName: "EVOLUTE",
    source: {
      id: "src-evolute-official-range-2026",
      title: "EVOLUTE official manufacturer site and current model range",
      publisher: "Motorinvest",
      url: "https://www.evolute.ru/",
      type: "manufacturer",
    },
    models: ["i-JOY", "i-JET", "i-PRO", "i-SKY", "i-SPACE", "i-VAN"],
  },
  {
    id: "solaris",
    canonicalName: "Solaris",
    source: {
      id: "src-agr-solaris-official-range-2026",
      title: "AGR official Solaris model range",
      publisher: "AGR Automotive Group",
      url: "https://agr.auto/solaris",
      type: "manufacturer",
    },
    models: ["HC", "HS", "KRS", "KRX"],
  },
  {
    id: "sollers",
    canonicalName: "Sollers",
    source: {
      id: "src-sollers-official-lcv-range-2026",
      title: "Sollers official LCV range archive and current portfolio",
      publisher: "SOLLERS PJSC",
      url: "https://sollers-auto.com/en/press-center/news-and-events/sollers-launches-a-project-to-set-up-lcv-production-under-its-own-brand/",
      type: "manufacturer",
    },
    models: ["Argo", "Atlant", "SF1", "SF5"],
  },
  {
    id: "tenet",
    canonicalName: "TENET",
    source: {
      id: "src-tenet-official-range-2026",
      title: "TENET official current model range",
      publisher: "TENET RUS LLC",
      url: "https://tenet.ru/models/",
      type: "manufacturer",
    },
    models: ["T4", "T4L", "T7", "T8"],
  },
  {
    id: "xcite",
    canonicalName: "XCITE",
    source: {
      id: "src-xcite-official-range-2024-2026",
      title: "XCITE official site: X-Cross model range",
      publisher: "St. Petersburg Automobile Plant",
      url: "https://xcite-center.ru/",
      type: "authoritative_catalog",
    },
    models: ["X-Cross 7", "X-Cross 8"],
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

export async function buildRussiaActiveBrandModelBatch01({ verifiedAt = "2026-08-17" } = {}) {
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
        supportedFields: ["canonicalName", "countries"],
        confidence: item.source.type === "manufacturer" ? "official" : "high",
        status: "active",
        license: null,
        notes: "Official or brand-authorized current-range identity source. The batch records English public brand/model identities only and does not infer technical configurations.",
      });
    }
    if (!existingBrands.has(item.id)) {
      brands.push({
        id: item.id,
        canonicalName: item.canonicalName,
        slug: item.id,
        aliases: [],
        countries: ["Russia"],
        status: "seed",
        evidence: [{
          sourceId: item.source.id,
          fields: ["canonicalName", "countries"],
          status: "verified",
          confidence: item.source.type === "manufacturer" ? "official" : "high",
          note: "The source identifies the brand and its active Russian-market vehicle range within the 2020-2026 priority window.",
        }],
        researchNotes: [
          "Authentic source-traceable 90 x 60 dark/light logos, rights review and complete generation/grade coverage remain required before publication.",
        ],
        updatedAt: verifiedAt,
      });
    }
    for (const canonicalName of item.models) {
      const id = `${item.id}/${slug(canonicalName)}`;
      if (existingModels.has(id)) continue;
      models.push({
        id,
        brandId: item.id,
        canonicalName,
        slug: slug(canonicalName),
        aliases: [],
        sourceNames: [],
        productionFrom: null,
        productionTo: null,
        bodyTypes: [],
        powertrainKinds: [],
        mediaIds: [],
        status: "review",
        evidence: [{
          sourceId: item.source.id,
          fields: ["canonicalName"],
          status: "verified",
          confidence: item.source.type === "manufacturer" ? "official" : "high",
          note: "The official or brand-authorized range page establishes this public model identity; dates and technical variants remain pending.",
        }],
        researchNotes: [
          "Priority-window model identity for the Russian 2020-2026 market.",
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
  const { report, ingestion } = await buildRussiaActiveBrandModelBatch01();
  await writeJson(REPORT_FILE, report);
  await writeJson(INGEST_FILE, ingestion);
  console.log(JSON.stringify(report.totals, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
