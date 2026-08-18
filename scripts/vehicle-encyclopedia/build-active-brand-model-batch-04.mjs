import path from "node:path";
import { pathToFileURL } from "node:url";
import { WORKSPACE_ROOT, loadWorkspace, writeJson } from "./lib.mjs";

const REPORT_FILE = path.join(WORKSPACE_ROOT, "reports/brand-model-active-04.json");
const INGEST_FILE = path.join(WORKSPACE_ROOT, "ingest/brand-model-active-04-2026-08-17.json");

const SOURCES = [
  {
    id: "src-kyc-azerbaijan-authorized-range-2026",
    type: "authoritative_catalog",
    title: "KYC Azerbaijan official distributor brand and model range",
    publisher: "KYC Azerbaijan / Automobiles Group",
    url: "https://kyc.az/en",
    market: "Azerbaijan",
    language: "en",
    supportedFields: ["canonicalName", "countries", "bodyTypes", "powertrainKinds"],
    confidence: "high",
    notes: "The authorized distributor explicitly identifies KYC as Changan Kuayue and lists the current D5 REEV, V5, V7, V5 EV and V7 EV model lines. No unlisted technical association is inferred.",
  },
  {
    id: "src-ciimo-secondary-identity-2026",
    type: "secondary_reference",
    title: "Ciimo brand identity and 2020-2024 product history",
    publisher: "Wikipedia",
    url: "https://en.wikipedia.org/wiki/Ciimo",
    market: "China",
    language: "en",
    supportedFields: ["canonicalName", "countries"],
    confidence: "medium",
    notes: "Secondary identity corroboration only. Ciimo remains review-only and cannot become an automatic make resolver without stronger manufacturer identity evidence.",
  },
  {
    id: "src-dongfeng-honda-mnv-official-2026",
    type: "manufacturer",
    title: "Dongfeng Honda official M-NV model page",
    publisher: "Dongfeng Honda Automobile Co., Ltd.",
    url: "https://www.dongfeng-honda.com/car/m-nv/",
    market: "China",
    language: "zh",
    supportedFields: ["canonicalName", "bodyTypes", "powertrainKinds"],
    confidence: "official",
    notes: "Official model page used only for the M-NV public identity and its electric passenger-SUV category; detailed values remain for a later exact variant batch.",
  },
];

const BRANDS = [
  {
    id: "kuayue",
    canonicalName: "Kuayue",
    aliases: [
      { value: "KYC", kind: "market_name", safe: true, language: "en", market: "Global" },
      { value: "Changan Kuayue", kind: "source_spelling", safe: true, language: "en", market: "Global" },
    ],
    countries: ["China"],
    status: "seed",
    sourceId: "src-kyc-azerbaijan-authorized-range-2026",
    confidence: "high",
  },
  {
    id: "ciimo",
    canonicalName: "CIIMO",
    aliases: [
      { value: "Ciimo", kind: "source_spelling", safe: false, language: "en", market: "China" },
      { value: "思铭", kind: "localized", safe: false, language: "zh", market: "China" },
    ],
    countries: ["China"],
    status: "review",
    sourceId: "src-ciimo-secondary-identity-2026",
    confidence: "medium",
  },
];

const MODELS = [
  { brandId: "kuayue", canonicalName: "D5 REEV", bodyTypes: ["Light truck"], powertrainKinds: ["EREV"], sourceId: "src-kyc-azerbaijan-authorized-range-2026", confidence: "high" },
  { brandId: "kuayue", canonicalName: "V5", bodyTypes: ["Microvan"], powertrainKinds: ["ICE"], sourceId: "src-kyc-azerbaijan-authorized-range-2026", confidence: "high" },
  { brandId: "kuayue", canonicalName: "V7", bodyTypes: ["Microvan"], powertrainKinds: ["ICE"], sourceId: "src-kyc-azerbaijan-authorized-range-2026", confidence: "high" },
  { brandId: "kuayue", canonicalName: "V5 EV", bodyTypes: ["Electric van"], powertrainKinds: ["BEV"], sourceId: "src-kyc-azerbaijan-authorized-range-2026", confidence: "high" },
  { brandId: "kuayue", canonicalName: "V7 EV", bodyTypes: ["Electric van"], powertrainKinds: ["BEV"], sourceId: "src-kyc-azerbaijan-authorized-range-2026", confidence: "high" },
  { brandId: "ciimo", canonicalName: "M-NV", bodyTypes: ["SUV"], powertrainKinds: ["BEV"], sourceId: "src-dongfeng-honda-mnv-official-2026", confidence: "official" },
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

export async function buildActiveBrandModelBatch04({ verifiedAt = "2026-08-17" } = {}) {
  const workspace = await loadWorkspace();
  const existingSources = new Set(workspace.records.source.map((source) => source.id));
  const existingBrands = new Set(workspace.records.brand.map((brand) => brand.id));
  const existingModels = new Set(workspace.records.model.map((model) => model.id));
  const sources = SOURCES.filter((source) => !existingSources.has(source.id)).map((source) => ({
    ...source,
    documentId: null,
    documentDate: null,
    verifiedAt,
    status: "active",
    license: null,
  }));
  const brands = BRANDS.filter((brand) => !existingBrands.has(brand.id)).map((brand) => ({
    id: brand.id,
    canonicalName: brand.canonicalName,
    slug: brand.id,
    aliases: brand.aliases.map((alias) => ({ ...alias, sourceIds: [brand.sourceId] })),
    countries: brand.countries,
    status: brand.status,
    evidence: [{
      sourceId: brand.sourceId,
      fields: ["canonicalName", "countries"],
      status: "verified",
      confidence: brand.confidence,
      note: brand.id === "ciimo"
        ? "The secondary source establishes a distinct China-market CIIMO identity; aliases stay unsafe until stronger manufacturer identity evidence is staged."
        : "The authorized distributor explicitly identifies KYC as the Changan Kuayue commercial-vehicle brand.",
    }],
    researchNotes: [
      "An authentic archived logo candidate exists but lacks a complete original source trace, so no logo media is staged.",
      "Review and logo-rights gates block production publication.",
    ],
    updatedAt: verifiedAt,
  }));
  const models = MODELS.map((model) => ({ ...model, id: `${model.brandId}/${slug(model.canonicalName)}` }))
    .filter((model) => !existingModels.has(model.id))
    .map((model) => ({
      id: model.id,
      brandId: model.brandId,
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
        sourceId: model.sourceId,
        fields: ["canonicalName", "bodyTypes", "powertrainKinds"],
        status: "verified",
        confidence: model.confidence,
        note: "The source explicitly lists this model line and its vehicle/powertrain category; exact generations and configurations are not inferred.",
      }],
      researchNotes: [
        "Active or priority-window 2020-2026 identity; review-only until exact generation and configuration research is complete.",
      ],
      updatedAt: verifiedAt,
    }));

  for (const rows of [sources, brands, models]) rows.sort((left, right) => left.id.localeCompare(right.id, "en"));
  return {
    report: {
      schemaVersion: 2,
      generatedAt: verifiedAt,
      productionConnected: false,
      totals: { newSources: sources.length, newBrands: brands.length, newModels: models.length },
      brandIds: BRANDS.map((brand) => brand.id),
      modelIds: models.map((model) => model.id),
      policy: {
        priorityWindow: "China/Azerbaijan active or 2020-2026 range",
        secondaryBrandAliasesRemainUnsafe: true,
        technicalConfigurationsNotInferred: true,
        untracedLogoCandidatesRejected: true,
        automaticPublicationReady: false,
      },
    },
    ingestion: { schemaVersion: 2, batches: [...chunks("source", sources), ...chunks("brand", brands), ...chunks("model", models)] },
  };
}

async function main() {
  const { report, ingestion } = await buildActiveBrandModelBatch04();
  await writeJson(REPORT_FILE, report);
  await writeJson(INGEST_FILE, ingestion);
  console.log(JSON.stringify(report.totals, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
