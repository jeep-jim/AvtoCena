import path from "node:path";
import { pathToFileURL } from "node:url";
import { WORKSPACE_ROOT, loadWorkspace, writeJson } from "./lib.mjs";

const REPORT_FILE = path.join(WORKSPACE_ROOT, "reports/baojun-current-models-2026.json");
const INGEST_FILE = path.join(WORKSPACE_ROOT, "ingest/baojun-current-models-2026-08-17.json");
const CURRENT_EN = "src-sgmw-baojun-current-en-2026";
const CURRENT_ZH = "src-sgmw-baojun-current-zh-2026";
const YEP_PLUS_LAUNCH = "src-sgmw-baojun-yep-plus-launch-2024";

const DEFINITIONS = [
  { slug: "yunhai", canonicalName: "Yunhai", localized: "宝骏 云海", sourceId: CURRENT_EN, productionFrom: null, bodyTypes: [], powertrainKinds: [], confidence: "official" },
  { slug: "yep-plus", canonicalName: "Yep Plus", localized: "宝骏 悦也Plus", sourceId: YEP_PLUS_LAUNCH, productionFrom: "2024", bodyTypes: ["SUV"], powertrainKinds: ["BEV"], confidence: "high" },
  { slug: "e6", canonicalName: "E6", localized: "宝骏 E6", sourceId: CURRENT_ZH, productionFrom: null, bodyTypes: [], powertrainKinds: [], confidence: "high" },
];

function chunk(entityType, records) {
  return { schemaVersion: 2, entityType, chunk: 1, maxRecords: 250, records };
}

function source({ id, title, url, documentDate = null, language, supportedFields, notes }, verifiedAt) {
  return {
    id,
    type: "manufacturer",
    title,
    publisher: "SAIC-GM-Wuling Automobile Co., Ltd. (SGMW)",
    url,
    documentId: null,
    documentDate,
    verifiedAt,
    market: "China",
    language,
    supportedFields,
    confidence: "official",
    status: "active",
    license: null,
    notes,
  };
}

export async function buildBaojunCurrentModelBatch({ verifiedAt = "2026-08-17" } = {}) {
  const workspace = await loadWorkspace();
  const existingSources = new Set(workspace.records.source.map((record) => record.id));
  const existingModels = new Set(workspace.records.model.map((record) => record.id));
  const sourceCandidates = [
    source({
      id: CURRENT_EN,
      title: "Baojun current model portfolio",
      url: "https://www.sgmw.com.cn/en/baojun",
      language: "en",
      supportedFields: ["canonicalName"],
      notes: "Official English current-range page used for the public Latin identities Yunhai and Xiangjing.",
    }, verifiedAt),
    source({
      id: CURRENT_ZH,
      title: "宝骏汽车当前车型阵容",
      url: "https://www.sgmw.com.cn/baojun",
      language: "zh-CN",
      supportedFields: ["canonicalName"],
      notes: "Official China current-range page used for exact source names. Edition labels such as travel, official-service and chauffeur are not duplicated as models.",
    }, verifiedAt),
    source({
      id: YEP_PLUS_LAUNCH,
      title: "上汽通用五菱正式官宣天舆架构与宝骏悦也Plus",
      url: "https://gxxnyqch.sgmw.com.cn/col24/143.html",
      documentDate: "2024-04-12",
      language: "zh-CN",
      supportedFields: ["canonicalName", "productionFrom", "bodyTypes", "powertrainKinds"],
      notes: "Official SGMW-led laboratory release explicitly describes Baojun Yueye Plus as a 2024 intelligent pure-electric SUV. Yep Plus is the conservative English public form and remains review-only.",
    }, verifiedAt),
  ];
  const sources = sourceCandidates.filter((record) => !existingSources.has(record.id));
  const models = DEFINITIONS.filter((definition) => !existingModels.has(`baojun/${definition.slug}`)).map((definition) => ({
    id: `baojun/${definition.slug}`,
    brandId: "baojun",
    canonicalName: definition.canonicalName,
    slug: definition.slug,
    aliases: [],
    sourceNames: [{
      value: definition.localized,
      kind: "localized",
      safe: true,
      language: "zh-CN",
      market: "China",
      sourceIds: [definition.sourceId === CURRENT_EN ? CURRENT_ZH : definition.sourceId],
    }],
    productionFrom: definition.productionFrom,
    productionTo: null,
    bodyTypes: definition.bodyTypes,
    powertrainKinds: definition.powertrainKinds,
    mediaIds: [],
    status: "review",
    evidence: [{
      sourceId: definition.sourceId,
      fields: ["canonicalName", ...(definition.productionFrom ? ["productionFrom", "bodyTypes", "powertrainKinds"] : [])],
      status: "verified",
      confidence: definition.confidence,
      note: definition.sourceId === CURRENT_EN
        ? "SGMW's official English current range supplies the public Latin identity."
        : definition.sourceId === YEP_PLUS_LAUNCH
          ? "The official 2024 release explicitly identifies Yueye Plus as a pure-electric SUV; Yep Plus is retained as a review-only public Latin normalization."
          : "SGMW's current China portfolio explicitly lists the model; E6 needs a model-specific page before any technical fields are staged.",
    }],
    researchNotes: [
      "No edition or sales-channel suffix is promoted to a standalone model.",
      "Publication and pricing remain disconnected until generation, exact specifications and canonical cover pass review.",
    ],
    updatedAt: verifiedAt,
  }));
  const report = {
    schemaVersion: 2,
    generatedAt: verifiedAt,
    productionConnected: false,
    totals: { candidateModels: DEFINITIONS.length, newSources: sources.length, newModels: models.length },
    modelIds: models.map((record) => record.id),
    policy: {
      currentOfficialPortfolioOnly: true,
      englishPublicIdentityRequired: true,
      salesEditionsNotDuplicatedAsModels: true,
      unspecifiedTechnicalFactsRejected: true,
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
      ],
    },
  };
}

async function main() {
  const { report, ingestion } = await buildBaojunCurrentModelBatch();
  await writeJson(REPORT_FILE, report);
  await writeJson(INGEST_FILE, ingestion);
  console.log(JSON.stringify(report.totals, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
