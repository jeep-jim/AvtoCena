import path from "node:path";
import { pathToFileURL } from "node:url";
import { WORKSPACE_ROOT, loadWorkspace, writeJson } from "./lib.mjs";

const REPORT_FILE = path.join(WORKSPACE_ROOT, "reports/hima-current-models-2026.json");
const INGEST_FILE = path.join(WORKSPACE_ROOT, "ingest/hima-current-models-2026-08-17.json");

const SOURCES = [
  {
    id: "src-huawei-hicar-current-models-2026",
    type: "authoritative_catalog",
    title: "Huawei HiCar supported vehicle model inventory",
    publisher: "Huawei Consumer Business Group",
    url: "https://consumer.huawei.com/cn/phones/hicar/available-car/",
    market: "China",
    language: "zh-CN",
    supportedFields: ["canonicalName"],
    confidence: "high",
    notes: "Official Huawei compatibility inventory used for exact Chinese HIMA model names and priority-window observations. Compatibility model years are not treated as production start dates.",
  },
  {
    id: "src-hima-aito-current-range-2026",
    type: "manufacturer",
    title: "HIMA AITO current official model range",
    publisher: "Huawei Device Co., Ltd. / HIMA",
    url: "https://hima.auto/wenjie/",
    market: "China",
    language: "zh-CN",
    supportedFields: ["canonicalName", "bodyTypes", "powertrainKinds"],
    confidence: "official",
    notes: "Official current AITO/问界 range page. Only explicit model, SUV and BEV/range-extender categories are retained; headline ranges and acceleration values are not promoted to generic variants.",
  },
  {
    id: "src-hima-luxeed-current-range-2026",
    type: "manufacturer",
    title: "HIMA LUXEED current official model range",
    publisher: "Huawei Device Co., Ltd. / HIMA",
    url: "https://hima.auto/zhijie/",
    market: "China",
    language: "zh-CN",
    supportedFields: ["canonicalName", "bodyTypes", "powertrainKinds"],
    confidence: "official",
    notes: "Official current LUXEED/智界 range page for S7, R7 and V9 identity and explicit vehicle/powertrain categories.",
  },
  {
    id: "src-hima-stelato-current-range-2026",
    type: "manufacturer",
    title: "HIMA STELATO current official model range",
    publisher: "Huawei Device Co., Ltd. / HIMA",
    url: "https://hima.auto/xiangjie/",
    market: "China",
    language: "zh-CN",
    supportedFields: ["canonicalName", "bodyTypes", "powertrainKinds"],
    confidence: "official",
    notes: "Official current STELATO/享界 range page for S9 and S9T identity and explicit BEV/range-extender categories.",
  },
  {
    id: "src-hima-maextro-current-range-2026",
    type: "manufacturer",
    title: "HIMA Maextro current official model range",
    publisher: "Huawei Device Co., Ltd. / HIMA",
    url: "https://hima.auto/zunjie/",
    market: "China",
    language: "zh-CN",
    supportedFields: ["canonicalName", "bodyTypes", "powertrainKinds"],
    confidence: "official",
    notes: "Official current Maextro/尊界 range page for S800, V800 and V680. V800/V680 powertrain types are not retained because the range headline alone does not define the system architecture.",
  },
  {
    id: "src-hima-shangjie-current-range-2026",
    type: "manufacturer",
    title: "HIMA SHANGJIE current official model range",
    publisher: "Huawei Device Co., Ltd. / HIMA",
    url: "https://hima.auto/shangjie/",
    market: "China",
    language: "zh-CN",
    supportedFields: ["canonicalName", "bodyTypes", "powertrainKinds"],
    confidence: "official",
    notes: "Official current SHANGJIE/尚界 page for H5 and Z7. Z7T is retained only from Huawei's explicit model-year inventory without inferred body or powertrain fields.",
  },
];

const MODELS = [
  { brandId: "aito", name: "M5", localized: "问界 M5", productionFrom: "2022", bodyTypes: ["SUV"], powertrainKinds: ["EREV", "BEV"], rangeSource: "src-hima-aito-current-range-2026" },
  { brandId: "aito", name: "M6", localized: "问界 M6", productionFrom: "2026", bodyTypes: ["SUV"], powertrainKinds: ["EREV", "BEV"], rangeSource: "src-hima-aito-current-range-2026" },
  { brandId: "aito", name: "M7", localized: "问界 M7", productionFrom: "2022", bodyTypes: ["SUV"], powertrainKinds: ["EREV", "BEV"], rangeSource: "src-hima-aito-current-range-2026" },
  { brandId: "aito", name: "M8", localized: "问界 M8", productionFrom: "2025", bodyTypes: ["SUV"], powertrainKinds: ["EREV", "BEV"], rangeSource: "src-hima-aito-current-range-2026" },
  { brandId: "luxeed", name: "R7", localized: "智界 R7", productionFrom: "2024", bodyTypes: ["SUV"], powertrainKinds: ["EREV", "BEV"], rangeSource: "src-hima-luxeed-current-range-2026" },
  { brandId: "luxeed", name: "S7", localized: "智界 S7", productionFrom: "2024", bodyTypes: ["Sedan"], powertrainKinds: ["BEV"], rangeSource: "src-hima-luxeed-current-range-2026" },
  { brandId: "luxeed", name: "V9", localized: "智界 V9", productionFrom: "2026", bodyTypes: ["MPV"], powertrainKinds: ["EREV"], rangeSource: "src-hima-luxeed-current-range-2026" },
  { brandId: "stelato", name: "S9", localized: "享界 S9", productionFrom: "2024", bodyTypes: ["Sedan"], powertrainKinds: ["EREV", "BEV"], rangeSource: "src-hima-stelato-current-range-2026" },
  { brandId: "stelato", name: "S9T", localized: "享界 S9T", productionFrom: "2025", bodyTypes: ["Station wagon"], powertrainKinds: ["EREV", "BEV"], rangeSource: "src-hima-stelato-current-range-2026" },
  { brandId: "maextro", name: "S800", localized: "尊界 S800", productionFrom: "2025", bodyTypes: ["Sedan"], powertrainKinds: ["EREV", "BEV"], rangeSource: "src-hima-maextro-current-range-2026" },
  { brandId: "maextro", name: "V800", localized: "尊界 V800", productionFrom: null, bodyTypes: ["MPV"], powertrainKinds: [], rangeSource: "src-hima-maextro-current-range-2026", inventorySource: false },
  { brandId: "maextro", name: "V680", localized: "尊界 V680", productionFrom: null, bodyTypes: ["MPV"], powertrainKinds: [], rangeSource: "src-hima-maextro-current-range-2026", inventorySource: false },
  { brandId: "shangjie", name: "H5", localized: "尚界 H5", productionFrom: "2025", bodyTypes: ["SUV"], powertrainKinds: ["EREV", "BEV"], rangeSource: "src-hima-shangjie-current-range-2026" },
  { brandId: "shangjie", name: "Z7", localized: "尚界 Z7", productionFrom: "2026", bodyTypes: ["Sportback"], powertrainKinds: ["BEV"], rangeSource: "src-hima-shangjie-current-range-2026" },
  { brandId: "shangjie", name: "Z7T", localized: "尚界 Z7T", productionFrom: "2026", bodyTypes: [], powertrainKinds: [], rangeSource: null },
];

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function chunk(entityType, records) {
  return { schemaVersion: 2, entityType, chunk: 1, maxRecords: 250, records };
}

function evidence(sourceId, fields, confidence, note) {
  return { sourceId, fields, status: "verified", confidence, note };
}

export async function buildHimaCurrentModelBatch({ verifiedAt = "2026-08-17" } = {}) {
  const workspace = await loadWorkspace();
  const existingSources = new Set(workspace.records.source.map((source) => source.id));
  const existingModels = new Set(workspace.records.model.map((model) => model.id));
  const sources = SOURCES.filter((source) => !existingSources.has(source.id)).map((source) => ({
    ...source,
    documentId: null,
    documentDate: null,
    verifiedAt,
    status: "active",
    license: null,
  }));
  const models = MODELS.map((model) => ({ ...model, id: `${model.brandId}/${slug(model.name)}` }))
    .filter((model) => !existingModels.has(model.id))
    .map((model) => {
      const facts = model.inventorySource === false ? [] : [evidence(
        "src-huawei-hicar-current-models-2026",
        ["canonicalName"],
        "high",
        "Huawei's official compatibility inventory explicitly lists this Chinese model identity inside the priority window; its compatibility year is not treated as a production start date.",
      )];
      if (model.rangeSource) facts.push(evidence(
        model.rangeSource,
        ["canonicalName", ...(model.bodyTypes.length ? ["bodyTypes"] : []), ...(model.powertrainKinds.length ? ["powertrainKinds"] : [])],
        "official",
        "The current HIMA brand page explicitly lists this model and the retained vehicle/powertrain categories.",
      ));
      return {
        id: model.id,
        brandId: model.brandId,
        canonicalName: model.name,
        slug: slug(model.name),
        aliases: [],
        sourceNames: [{
          value: model.localized,
          kind: "localized",
          safe: true,
          language: "zh-CN",
          market: "China",
          sourceIds: [...(model.inventorySource === false ? [] : ["src-huawei-hicar-current-models-2026"]), ...(model.rangeSource ? [model.rangeSource] : [])],
        }],
        productionFrom: null,
        productionTo: null,
        bodyTypes: model.bodyTypes,
        powertrainKinds: model.powertrainKinds,
        mediaIds: [],
        status: "review",
        evidence: facts,
        researchNotes: [
          "Current 2020-2026 high-demand China model identity; review-only until exact generations, configurations and media pass approval.",
          "Huawei compatibility model years are scope observations only and are not copied into productionFrom.",
          "Headline maximum range or acceleration values are not attached to a generic model or invented variant.",
        ],
        updatedAt: verifiedAt,
      };
    });
  for (const rows of [sources, models]) rows.sort((left, right) => left.id.localeCompare(right.id, "en"));
  const report = {
    schemaVersion: 2,
    generatedAt: verifiedAt,
    productionConnected: false,
    totals: { newSources: sources.length, newModels: models.length },
    brandIds: [...new Set(MODELS.map((model) => model.brandId))].sort(),
    modelIds: models.map((model) => model.id),
    policy: {
      priority: "Current high-demand HIMA model families",
      officialCurrentRangeRequired: true,
      exactChineseAliasesRetained: true,
      compatibilityYearsNotProductionDates: true,
      headlineSpecsNotPromotedToVariants: true,
      unknownPowertrainOrBodyNotInferred: true,
      automaticPublicationReady: false,
    },
  };
  return {
    report,
    ingestion: { schemaVersion: 2, batches: [...(sources.length ? [chunk("source", sources)] : []), ...(models.length ? [chunk("model", models)] : [])] },
  };
}

async function main() {
  const { report, ingestion } = await buildHimaCurrentModelBatch();
  await writeJson(REPORT_FILE, report);
  await writeJson(INGEST_FILE, ingestion);
  console.log(JSON.stringify(report.totals, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
