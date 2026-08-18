import path from "node:path";
import { pathToFileURL } from "node:url";
import { WORKSPACE_ROOT, loadWorkspace, writeJson } from "./lib.mjs";

const REPORT_FILE = path.join(WORKSPACE_ROOT, "reports/hyundai-elexio-official-2025.json");
const INGEST_FILE = path.join(WORKSPACE_ROOT, "ingest/hyundai-elexio-official-2025-2026-08-17.json");
const SOURCE_ID = "src-hyundai-elexio-china-launch-2025";

function chunk(entityType, records) {
  return { schemaVersion: 2, entityType, chunk: 1, maxRecords: 250, records };
}

function evidence(fields, note) {
  return [{ sourceId: SOURCE_ID, fields, status: "verified", confidence: "official", note }];
}

export async function buildHyundaiElexioBatch({ verifiedAt = "2026-08-17" } = {}) {
  const workspace = await loadWorkspace();
  const existing = Object.fromEntries(["source", "model", "generation", "variant"]
    .map((type) => [type, new Set(workspace.records[type].map((record) => record.id))]));

  const sources = existing.source.has(SOURCE_ID) ? [] : [{
    id: SOURCE_ID,
    type: "manufacturer",
    title: "Hyundai Motor Launches All-New ELEXIO SUV and Unveils New Energy Vehicle Strategy for China",
    publisher: "Hyundai Motor Company",
    url: "https://www.hyundai.com/worldwide/en/newsroom/detail/0000001035",
    documentId: null,
    documentDate: "2025-10-30",
    verifiedAt,
    market: "China",
    language: "en",
    supportedFields: [
      "canonicalName", "productionFrom", "bodyTypes", "powertrainKinds", "name", "platformCodes",
      "market", "yearFrom", "bodyType", "powertrainKind", "rangeKm", "rangeStandard",
    ],
    confidence: "official",
    status: "active",
    license: null,
    notes: "Official launch record. The stated 88.1 kWh value is retained in evidence notes but is not mapped to gross, usable or rated battery capacity because the manufacturer does not identify that basis.",
  }];

  const models = existing.model.has("hyundai/elexio") ? [] : [{
    id: "hyundai/elexio",
    brandId: "hyundai",
    canonicalName: "ELEXIO",
    slug: "elexio",
    aliases: [],
    sourceNames: [{
      value: "羿欧",
      kind: "localized",
      safe: true,
      language: "zh-CN",
      market: "China",
      sourceIds: ["src-huawei-hicar-current-models-2026"],
    }],
    productionFrom: "2025",
    productionTo: null,
    bodyTypes: ["SUV"],
    powertrainKinds: ["BEV"],
    mediaIds: [],
    status: "review",
    evidence: evidence(
      ["canonicalName", "productionFrom", "bodyTypes", "powertrainKinds"],
      "Hyundai's official launch identifies ELEXIO as an all-new all-electric SUV for China in 2025.",
    ),
    researchNotes: [
      "The localized Chinese source spelling is search-only and cannot replace the English public name ELEXIO.",
      "Review-only until the model cover and publication review are complete.",
    ],
    updatedAt: verifiedAt,
  }];

  const generations = existing.generation.has("hyundai/elexio/e-gmp") ? [] : [{
    id: "hyundai/elexio/e-gmp",
    modelId: "hyundai/elexio",
    name: "E-GMP",
    aliases: [],
    platformCodes: ["E-GMP"],
    productionFrom: "2025",
    productionTo: null,
    bodyTypes: ["SUV"],
    status: "review",
    evidence: evidence(
      ["name", "platformCodes", "productionFrom", "bodyTypes"],
      "The launch states that ELEXIO is an SUV built on Hyundai's E-GMP platform; the launch date bounds this first observed generation to 2025.",
    ),
    researchNotes: ["No internal platform or generation code is inferred beyond the explicitly named E-GMP architecture."],
    updatedAt: verifiedAt,
  }];

  const variantId = "hyundai/elexio/e-gmp/china-722-km-cltc";
  const variants = existing.variant.has(variantId) ? [] : [{
    id: variantId,
    modelId: "hyundai/elexio",
    generationId: "hyundai/elexio/e-gmp",
    faceliftId: null,
    name: "722 km CLTC",
    aliases: [],
    market: "China",
    yearFrom: 2025,
    yearTo: null,
    bodyType: "SUV",
    powertrainKind: "BEV",
    rangeKm: 722,
    rangeStandard: "CLTC",
    status: "review",
    evidence: evidence(
      ["name", "market", "yearFrom", "bodyType", "powertrainKind", "rangeKm", "rangeStandard"],
      "The official launch pairs the ELEXIO with a 722 km CLTC range and an 88.1 kWh battery. Capacity is deliberately not mapped because gross, usable and rated basis are unspecified.",
    ),
    researchNotes: [
      "Review-only manufacturer specification; production pricing remains disconnected.",
      "No motor output, drive layout, charging power or 30-minute power is inferred from this launch record.",
    ],
    updatedAt: verifiedAt,
  }];

  const report = {
    schemaVersion: 2,
    generatedAt: verifiedAt,
    productionConnected: false,
    totals: {
      newSources: sources.length,
      newModels: models.length,
      newGenerations: generations.length,
      newVariants: variants.length,
    },
    sourceIds: sources.map((source) => source.id),
    modelIds: models.map((model) => model.id),
    generationIds: generations.map((generation) => generation.id),
    variantIds: variants.map((variant) => variant.id),
    policy: {
      englishCanonicalNameRequired: true,
      localizedNameSearchOnly: true,
      unspecifiedBatteryBasisRejected: true,
      power30MinNotDerived: true,
      automaticPublicationReady: false,
    },
  };

  return {
    report,
    ingestion: {
      schemaVersion: 2,
      batches: [
        ...(sources.length ? [chunk("source", sources)] : []),
        ...(models.length ? [chunk("model", models)] : []),
        ...(generations.length ? [chunk("generation", generations)] : []),
        ...(variants.length ? [chunk("variant", variants)] : []),
      ],
    },
  };
}

async function main() {
  const { report, ingestion } = await buildHyundaiElexioBatch();
  await writeJson(REPORT_FILE, report);
  await writeJson(INGEST_FILE, ingestion);
  console.log(JSON.stringify(report.totals, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
