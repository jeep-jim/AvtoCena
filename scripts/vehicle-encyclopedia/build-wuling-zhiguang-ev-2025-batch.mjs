import path from "node:path";
import { pathToFileURL } from "node:url";
import { WORKSPACE_ROOT, loadWorkspace, writeJson } from "./lib.mjs";

const REPORT_FILE = path.join(WORKSPACE_ROOT, "reports/wuling-zhiguang-ev-2025-specifications.json");
const INGEST_FILE = path.join(WORKSPACE_ROOT, "ingest/wuling-zhiguang-ev-2025-specifications-2026-08-17.json");
const MODEL_ID = "wuling/zhiguang";
const GENERATION_ID = `${MODEL_ID}/ev-2025`;
const SPEC_SOURCE_ID = "src-sgmw-wuling-zhiguang-ev-spec";
const LAUNCH_SOURCE_ID = "src-sgmw-wuling-zhiguang-ev-launch-history-2025";
const LONG_RANGE_SOURCE_ID = "src-sgmw-wuling-zhiguang-ev-305-launch-2025";

const DEFINITIONS = [
  { slug: "standard-201-km", sourceName: "标准型", name: "Standard 201 km", rangeKm: 201, heightMm: 1750, grossWeightKg: 1220 },
  { slug: "comfort-201-km", sourceName: "舒适型", name: "Comfort 201 km", rangeKm: 201, heightMm: 1765, grossWeightKg: 1220 },
  { slug: "progress-305-km", sourceName: "进取型", name: "Progress 305 km", rangeKm: 305, heightMm: 1765, grossWeightKg: 1350 },
];

function chunk(entityType, records) {
  return { schemaVersion: 2, entityType, chunk: 1, maxRecords: 250, records };
}

function evidence(sourceId, fields, note) {
  return [{ sourceId, fields, status: "verified", confidence: "official", note }];
}

function alias(value, sourceId) {
  return { value, kind: "localized", safe: true, language: "zh-CN", market: "China", sourceIds: [sourceId] };
}

export async function buildWulingZhiguangEv2025Batch({ verifiedAt = "2026-08-17" } = {}) {
  const workspace = await loadWorkspace();
  const existingModel = workspace.records.model.find((record) => record.id === MODEL_ID);
  if (!existingModel) throw new Error(`${MODEL_ID} is missing`);
  const sourceIds = new Set(workspace.records.source.map((record) => record.id));
  const generationIds = new Set(workspace.records.generation.map((record) => record.id));
  const variantIds = new Set(workspace.records.variant.map((record) => record.id));

  const sourceDefinitions = [
    {
      id: SPEC_SOURCE_ID,
      type: "manufacturer_technical_document",
      title: "五菱之光EV参数配置",
      publisher: "SAIC-GM-Wuling Automobile Co., Ltd. (SGMW)",
      url: "https://www.sgmw.com.cn/carDetail?id=275",
      documentId: "SGMW carDetail 275",
      documentDate: null,
      verifiedAt,
      market: "China",
      language: "zh-CN",
      supportedFields: [
        "bodyTypes", "name", "market", "bodyType", "powertrainKind", "drive", "motorPeakKw", "rangeKm",
        "lengthMm", "widthMm", "heightMm", "wheelbaseMm", "grossWeightKg", "seats", "topSpeedKmh",
      ],
      confidence: "official",
      status: "active",
      license: null,
      notes: "Exact three-column manufacturer table. Battery values are not mapped because gross, usable or rated basis is not stated. The table's 16/30 kW rated/peak row contributes only the explicit 30 kW peak value; rated power is not treated as legal 30-minute power. The range test standard is not stated and is not inferred.",
    },
    {
      id: LAUNCH_SOURCE_ID,
      type: "manufacturer",
      title: "上汽通用五菱一季度实销377257辆",
      publisher: "SAIC-GM-Wuling Automobile Co., Ltd. (SGMW)",
      url: "https://lu.sgmw.com.cn/portal/details.html?id=50227",
      documentId: "SGMW portal 50227",
      documentDate: "2025-04-02",
      verifiedAt,
      market: "China",
      language: "zh-CN",
      supportedFields: ["productionFrom", "yearFrom", "name", "bodyTypes", "powertrainKinds", "bodyType"],
      confidence: "official",
      status: "active",
      license: null,
      notes: "Official sales record explicitly states that Zhiguang EV launched in February 2025 and identifies it as a new-energy microvan.",
    },
    {
      id: LONG_RANGE_SOURCE_ID,
      type: "manufacturer",
      title: "全球新能源商用车引领者！五菱红标7月销量49,020辆",
      publisher: "SAIC-GM-Wuling Automobile Co., Ltd. (SGMW)",
      url: "https://lu.sgmw.com.cn/portal/details.html?id=51893",
      documentId: "SGMW portal 51893",
      documentDate: "2025-08-06",
      verifiedAt,
      market: "China",
      language: "zh-CN",
      supportedFields: ["name", "yearFrom", "rangeKm"],
      confidence: "official",
      status: "active",
      license: null,
      notes: "Official sales record states that the 305 km Progress grade launched on 2025-07-23.",
    },
  ];
  const sources = sourceDefinitions.filter((source) => !sourceIds.has(source.id));

  const replacementModel = {
    ...existingModel,
    bodyTypes: ["Van"],
    powertrainKinds: ["BEV", "ICE"],
    evidence: [
      ...existingModel.evidence,
      ...evidence(LAUNCH_SOURCE_ID, ["bodyTypes", "powertrainKinds"], "Van is the normalized public body classification for SGMW's explicitly described new-energy microvan; the current family retains BEV and ICE forms."),
    ],
    researchNotes: [...existingModel.researchNotes, "Three exact 2025 Zhiguang EV configurations are staged below; publication and pricing remain disconnected."],
    updatedAt: verifiedAt,
  };

  const generations = generationIds.has(GENERATION_ID) ? [] : [{
    id: GENERATION_ID,
    modelId: MODEL_ID,
    name: "EV (2025)",
    aliases: [alias("之光EV", LAUNCH_SOURCE_ID)],
    platformCodes: [],
    productionFrom: "2025-02",
    productionTo: null,
    bodyTypes: ["Van"],
    status: "review",
    evidence: evidence(LAUNCH_SOURCE_ID, ["name", "productionFrom", "bodyTypes"], "SGMW records a February 2025 launch and describes the vehicle as a new-energy microvan, normalized to Van."),
    researchNotes: ["Powertrain-edition container only; no unverified platform or internal generation code is inferred."],
    updatedAt: verifiedAt,
  }];

  const variants = DEFINITIONS
    .filter((definition) => !variantIds.has(`${GENERATION_ID}/${definition.slug}`))
    .map((definition) => ({
      id: `${GENERATION_ID}/${definition.slug}`,
      modelId: MODEL_ID,
      generationId: GENERATION_ID,
      faceliftId: null,
      name: definition.name,
      aliases: [alias(definition.sourceName, SPEC_SOURCE_ID)],
      market: "China",
      yearFrom: 2025,
      yearTo: null,
      bodyType: "Van",
      powertrainKind: "BEV",
      drive: "RWD",
      motorPeakKw: 30,
      rangeKm: definition.rangeKm,
      lengthMm: 3685,
      widthMm: 1530,
      heightMm: definition.heightMm,
      wheelbaseMm: 2600,
      grossWeightKg: definition.grossWeightKg,
      seats: 4,
      topSpeedKmh: 100,
      status: "review",
      evidence: [
        ...evidence(LAUNCH_SOURCE_ID, ["yearFrom", "bodyType"], "Official record confirms the 2025 launch year and microvan classification, normalized to Van."),
        ...(definition.rangeKm === 305 ? evidence(LONG_RANGE_SOURCE_ID, ["name", "rangeKm"], "SGMW explicitly records the 305 km Progress grade launch.") : []),
        ...evidence(
          SPEC_SOURCE_ID,
          ["name", "market", "powertrainKind", "drive", "motorPeakKw", "rangeKm", "lengthMm", "widthMm", "heightMm", "wheelbaseMm", "grossWeightKg", "seats", "topSpeedKmh"],
          "Exact values transcribed column-for-column from SGMW's three-column Zhiguang EV table; rear-mounted rear drive is normalized to RWD.",
        ),
      ],
      researchNotes: [
        "Battery capacity is intentionally not assigned to gross, usable or rated capacity without an explicit basis.",
        "The source does not state the range test standard. Its 16 kW rated motor value is not stored as legal 30-minute power; only the exact 30 kW peak value is mapped.",
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
      exactManufacturerValuesOnly: true,
      EnglishCanonicalLocalizedAliases: true,
      rangeStandardNotInferred: true,
      batteryBasisUnspecifiedAndRejected: true,
      ratedMotorNotPower30Min: true,
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
  const { report, ingestion } = await buildWulingZhiguangEv2025Batch();
  await writeJson(REPORT_FILE, report);
  await writeJson(INGEST_FILE, ingestion);
  console.log(JSON.stringify(report.totals, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
