import path from "node:path";
import { pathToFileURL } from "node:url";
import { WORKSPACE_ROOT, loadWorkspace, writeJson } from "./lib.mjs";

const REPORT_FILE = path.join(WORKSPACE_ROOT, "reports/wuling-starlight-2025-lineup.json");
const INGEST_FILE = path.join(WORKSPACE_ROOT, "ingest/wuling-starlight-2025-lineup-2026-08-17.json");
const MODEL_ID = "wuling/starlight";
const GENERATION_ID = `${MODEL_ID}/2025-model-year`;
const ORIGINAL_SOURCE_ID = "src-gm-wuling-starlight-launch-en-2023";
const MODEL_YEAR_SOURCE_ID = "src-gm-wuling-starlight-2025-launch-zh";

const VARIANTS = [
  { slug: "phev-70-km-smart-standard", sourceName: "插混70km智能标准型", name: "PHEV 70 km Smart Standard", kind: "PHEV", rangeKm: 70 },
  { slug: "phev-150-km-smart-advanced", sourceName: "插混150km智能进阶型", name: "PHEV 150 km Smart Advanced", kind: "PHEV", rangeKm: 150 },
  { slug: "phev-150-km-smart-pilot", sourceName: "插混150km智能领航型", name: "PHEV 150 km Smart Pilot", kind: "PHEV", rangeKm: 150 },
  { slug: "bev-510-km-smart-advanced", sourceName: "纯电510km智能进阶型", name: "BEV 510 km Smart Advanced", kind: "BEV", rangeKm: 510 },
  { slug: "bev-610-km-smart-advanced", sourceName: "纯电610km智能进阶型", name: "BEV 610 km Smart Advanced", kind: "BEV", rangeKm: 610 },
  { slug: "bev-610-km-smart-flagship", sourceName: "纯电610km智能旗舰型", name: "BEV 610 km Smart Flagship", kind: "BEV", rangeKm: 610 },
];

function chunk(entityType, records) {
  return { schemaVersion: 2, entityType, chunk: 1, maxRecords: 250, records };
}

function evidence(sourceId, fields, note) {
  return [{ sourceId, fields, status: "verified", confidence: "official", note }];
}

function alias(value) {
  return { value, kind: "localized", safe: true, language: "zh-CN", market: "China", sourceIds: [MODEL_YEAR_SOURCE_ID] };
}

export async function buildWulingStarlight2025LineupBatch({ verifiedAt = "2026-08-17" } = {}) {
  const workspace = await loadWorkspace();
  const existingModel = workspace.records.model.find((record) => record.id === MODEL_ID);
  if (!existingModel) throw new Error(`${MODEL_ID} is missing`);
  const sourceIds = new Set(workspace.records.source.map((record) => record.id));
  const generationIds = new Set(workspace.records.generation.map((record) => record.id));
  const variantIds = new Set(workspace.records.variant.map((record) => record.id));

  const sourceDefinitions = [
    {
      id: ORIGINAL_SOURCE_ID,
      type: "manufacturer",
      title: "SAIC-GM-Wuling Adds Wuling Xing Guang PHEV to Its NEV Portfolio",
      publisher: "General Motors / SAIC-GM-Wuling",
      url: "https://news.gm.com.cn/en/home.detail.html/Pages/news/cn/en/2023/Dec/1205-wuling.html",
      documentId: "GM China Wuling 2023-12-06 EN",
      documentDate: "2023-12-06",
      verifiedAt,
      market: "China",
      language: "en",
      supportedFields: ["canonicalName", "productionFrom", "bodyTypes", "powertrainKinds"],
      confidence: "official",
      status: "active",
      license: null,
      notes: "Official English launch explains that Xing Guang means Starlight, identifies the family sedan body and dates the original PHEV launch. The 2025 BEV expansion is sourced separately.",
    },
    {
      id: MODEL_YEAR_SOURCE_ID,
      type: "manufacturer",
      title: "限时先享置换一口价！「10万级600续航中级轿车」五菱星光2025款正式上市！",
      publisher: "General Motors / SAIC-GM-Wuling",
      url: "https://news.gm.com.cn/zh/home.detail.html/Pages/news/cn/zh/2025/may/0528-wuling.html",
      documentId: "GM China Wuling 2025-05-28 ZH",
      documentDate: "2025-05-28",
      verifiedAt,
      market: "China",
      language: "zh-CN",
      supportedFields: ["name", "productionFrom", "bodyTypes", "powertrainKinds", "market", "yearFrom", "bodyType", "powertrainKind", "rangeKm"],
      confidence: "official",
      status: "active",
      license: null,
      notes: "Official 2025 model-year launch names all six PHEV and BEV configurations and their advertised electric-range figures. The release does not attach a test cycle to each grade, so rangeStandard is intentionally empty.",
    },
  ];
  const sources = sourceDefinitions.filter((source) => !sourceIds.has(source.id));

  const replacementModel = {
    ...existingModel,
    productionFrom: "2023-12",
    bodyTypes: ["Sedan"],
    powertrainKinds: ["PHEV", "BEV"],
    evidence: [
      ...existingModel.evidence,
      ...evidence(ORIGINAL_SOURCE_ID, ["canonicalName", "productionFrom", "bodyTypes"], "Official English release says Xing Guang means Starlight and records the December 2023 family-sedan launch."),
      ...evidence(MODEL_YEAR_SOURCE_ID, ["powertrainKinds"], "Official 2025 release confirms both PHEV and BEV forms."),
    ],
    researchNotes: [
      ...existingModel.researchNotes,
      "All six official 2025 model-year grades are staged below with English public names and exact Chinese source aliases.",
    ],
    updatedAt: verifiedAt,
  };

  const generations = generationIds.has(GENERATION_ID) ? [] : [{
    id: GENERATION_ID,
    modelId: MODEL_ID,
    name: "2025 model year",
    aliases: [],
    platformCodes: [],
    productionFrom: "2025-05",
    productionTo: null,
    bodyTypes: ["Sedan"],
    status: "review",
    evidence: evidence(MODEL_YEAR_SOURCE_ID, ["name", "productionFrom", "bodyTypes"], "Official release confirms the six-grade 2025 model year launched on 2025-05-28."),
    researchNotes: ["Model-year container only; it does not assert a new platform generation or facelift code."],
    updatedAt: verifiedAt,
  }];

  const variants = VARIANTS
    .filter((definition) => !variantIds.has(`${GENERATION_ID}/${definition.slug}`))
    .map((definition) => ({
      id: `${GENERATION_ID}/${definition.slug}`,
      modelId: MODEL_ID,
      generationId: GENERATION_ID,
      faceliftId: null,
      name: definition.name,
      aliases: [alias(definition.sourceName)],
      market: "China",
      yearFrom: 2025,
      yearTo: null,
      bodyType: "Sedan",
      powertrainKind: definition.kind,
      rangeKm: definition.rangeKm,
      status: "review",
      evidence: evidence(MODEL_YEAR_SOURCE_ID, ["name", "market", "yearFrom", "bodyType", "powertrainKind", "rangeKm"], "Exact 2025 grade identity, powertrain and advertised electric-range figure are transcribed from SGMW's official launch release."),
      researchNotes: [
        "Sparse official grade identity: technical values absent from the launch release remain empty until a manufacturer specification table is available.",
        "rangeStandard is intentionally omitted because the release does not state a cycle for each listed grade; 69.2 kWh is not assigned because the battery-capacity basis is unstated.",
      ],
      updatedAt: verifiedAt,
    }));

  const report = {
    schemaVersion: 2,
    generatedAt: verifiedAt,
    productionConnected: false,
    totals: { newSources: sources.length, replacedModels: 1, newGenerations: generations.length, newVariants: variants.length },
    modelId: MODEL_ID,
    generationIds: [GENERATION_ID],
    variantIds: variants.map((record) => record.id),
    policy: {
      officialSourcesOnly: true,
      EnglishCanonicalLocalizedAliases: true,
      complete2025GradeList: true,
      unstatedSpecificationsRejected: true,
      rangeCycleNotInferred: true,
      batteryBasisUnspecifiedAndRejected: true,
      automaticPublicationReady: false,
    },
  };

  return {
    report,
    ingestion: {
      schemaVersion: 2,
      batches: [
        ...(sources.length ? [chunk("source", sources)] : []),
        chunk("model", [replacementModel]),
        ...(generations.length ? [chunk("generation", generations)] : []),
        ...(variants.length ? [chunk("variant", variants)] : []),
      ],
    },
  };
}

async function main() {
  const { report, ingestion } = await buildWulingStarlight2025LineupBatch();
  await writeJson(REPORT_FILE, report);
  await writeJson(INGEST_FILE, ingestion);
  console.log(JSON.stringify(report.totals, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
