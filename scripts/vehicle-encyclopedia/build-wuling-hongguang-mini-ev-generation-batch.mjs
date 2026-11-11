import path from "node:path";
import { pathToFileURL } from "node:url";
import { WORKSPACE_ROOT, loadWorkspace, writeJson } from "./lib.mjs";

const REPORT_FILE = path.join(WORKSPACE_ROOT, "reports/wuling-hongguang-mini-ev-generations.json");
const INGEST_FILE = path.join(WORKSPACE_ROOT, "ingest/wuling-hongguang-mini-ev-generations-2026-08-17.json");
const MODEL_ID = "wuling/hongguang-mini-ev";
const FOUR_DOOR_GENERATION_ID = `${MODEL_ID}/four-door-2025`;
const FIFTH_GENERATION_ID = `${MODEL_ID}/fifth-generation`;

const SOURCE = {
  fourDoorSpec: "src-sgmw-hongguang-mini-ev-four-door-spec",
  fourDoorLaunch: "src-sgmw-hongguang-mini-ev-four-door-launch-2025",
  fifthLaunch: "src-sgmw-hongguang-mini-ev-fifth-generation-launch-2026",
  fifthTechnical: "src-sgmw-hongguang-mini-ev-fifth-generation-technical-2026",
  evolution: "src-sgmw-hongguang-mini-ev-five-generation-evolution-2026",
};

const FOUR_DOOR_VARIANTS = [
  { slug: "advanced-205-km", sourceName: "进阶款", name: "Advanced 205 km" },
  { slug: "premium-205-km", sourceName: "臻享款", name: "Premium 205 km" },
  { slug: "premium-plus-205-km", sourceName: "臻享+款", name: "Premium+ 205 km" },
];

const FIFTH_GENERATION_VARIANTS = [
  { slug: "advanced-205-km", sourceName: "205km进阶款", name: "Advanced 205 km", rangeKm: 205 },
  { slug: "premium-205-km", sourceName: "205km臻享款", name: "Premium 205 km", rangeKm: 205 },
  { slug: "advanced-301-km", sourceName: "301km进阶款", name: "Advanced 301 km", rangeKm: 301 },
  { slug: "premium-301-km", sourceName: "301km臻享款", name: "Premium 301 km", rangeKm: 301 },
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

export async function buildWulingHongguangMiniEvGenerationBatch({ verifiedAt = "2026-08-17" } = {}) {
  const workspace = await loadWorkspace();
  const existingModel = workspace.records.model.find((record) => record.id === MODEL_ID);
  if (!existingModel) throw new Error(`${MODEL_ID} is missing`);
  const sourceIds = new Set(workspace.records.source.map((record) => record.id));
  const generationIds = new Set(workspace.records.generation.map((record) => record.id));
  const variantIds = new Set(workspace.records.variant.map((record) => record.id));

  const sourceDefinitions = [
    {
      id: SOURCE.fourDoorSpec,
      type: "manufacturer_technical_document",
      title: "宏光MINIEV 四门版参数配置",
      publisher: "SAIC-GM-Wuling Automobile Co., Ltd. (SGMW)",
      url: "https://www.sgmw.com.cn/carDetail?id=273",
      documentId: "SGMW carDetail 273",
      documentDate: null,
      verifiedAt,
      market: "China",
      language: "zh-CN",
      supportedFields: [
        "bodyTypes", "name", "market", "yearFrom", "bodyType", "powertrainKind", "drive",
        "motorPeakKw", "rangeKm", "rangeStandard", "lengthMm", "widthMm", "heightMm",
        "wheelbaseMm", "curbWeightKg", "seats", "doors", "topSpeedKmh",
      ],
      confidence: "official",
      status: "active",
      license: null,
      notes: "Exact three-column four-door manufacturer table. The 16.2 kWh battery value is not mapped because the table does not identify gross, usable or rated basis. Maximum motor power is not reused as legal 30-minute power.",
    },
    {
      id: SOURCE.fourDoorLaunch,
      type: "manufacturer",
      title: "宏光MINIEV四门版正式上市",
      publisher: "SAIC-GM-Wuling Automobile Co., Ltd. (SGMW)",
      url: "https://lu.sgmw.com.cn/portal/details.html?id=49721",
      documentId: "SGMW portal 49721",
      documentDate: "2025-02-24",
      verifiedAt,
      market: "China",
      language: "zh-CN",
      supportedFields: ["name", "productionFrom", "yearFrom"],
      confidence: "official",
      status: "active",
      license: null,
      notes: "Official launch record states that the four-door edition launched on 2025-02-22 in Advanced, Premium and Premium+ configurations.",
    },
    {
      id: SOURCE.fifthLaunch,
      type: "manufacturer",
      title: "第五代宏光MINIEV正式上市",
      publisher: "SAIC-GM-Wuling Automobile Co., Ltd. (SGMW)",
      url: "https://lu.sgmw.com.cn/portal/details.html?id=55608",
      documentId: "SGMW portal 55608",
      documentDate: "2026-03-30",
      verifiedAt,
      market: "China",
      language: "zh-CN",
      supportedFields: ["name", "productionFrom", "yearFrom", "rangeKm", "rangeStandard", "lengthMm", "widthMm", "heightMm", "seats", "doors"],
      confidence: "official",
      status: "active",
      license: null,
      notes: "Official launch record states a 2026-03-27 launch and names four 205 km and 301 km configurations.",
    },
    {
      id: SOURCE.fifthTechnical,
      type: "manufacturer_technical_document",
      title: "第五代宏光MINIEV开启预售",
      publisher: "SAIC-GM-Wuling Automobile Co., Ltd. (SGMW)",
      url: "https://lu.sgmw.com.cn/portal/details.html?id=55218",
      documentId: "SGMW portal 55218",
      documentDate: "2026-03-06",
      verifiedAt,
      market: "China",
      language: "zh-CN",
      supportedFields: ["platformCodes", "bodyTypes", "powertrainKinds", "market", "bodyType", "powertrainKind", "motorPeakKw", "rangeKm", "rangeStandard", "lengthMm", "widthMm", "heightMm", "seats", "doors"],
      confidence: "official",
      status: "active",
      license: null,
      notes: "Official technical release identifies the S platform, four-door/four-seat layout, 30 kW electric drive, dimensions and 205/301 km CLTC ranges. No legal 30-minute power is stated.",
    },
    {
      id: SOURCE.evolution,
      type: "manufacturer",
      title: "宏光MINIEV五代进化",
      publisher: "SAIC-GM-Wuling Automobile Co., Ltd. (SGMW)",
      url: "https://lu.sgmw.com.cn/portal/details.html?id=55922",
      documentId: "SGMW portal 55922",
      documentDate: "2026-04-21",
      verifiedAt,
      market: "China",
      language: "zh-CN",
      supportedFields: ["productionFrom", "canonicalName"],
      confidence: "official",
      status: "active",
      license: null,
      notes: "Official five-generation history explicitly dates the first Hongguang MINIEV generation to 2020 and the fifth generation to 2026.",
    },
  ];
  const sources = sourceDefinitions.filter((source) => !sourceIds.has(source.id));

  const replacementModel = {
    ...existingModel,
    productionFrom: "2020",
    bodyTypes: ["Hatchback"],
    powertrainKinds: ["BEV"],
    evidence: [
      ...existingModel.evidence,
      ...evidence(SOURCE.evolution, ["productionFrom"], "SGMW's official five-generation history dates the original model to 2020."),
      ...evidence(SOURCE.fourDoorSpec, ["bodyTypes"], "Hatchback is the normalized public body classification for the official compact four-door passenger-car body."),
    ],
    researchNotes: [
      ...existingModel.researchNotes,
      "Two source-backed China containers and seven exact configurations are staged below; publication and pricing remain disconnected.",
    ],
    updatedAt: verifiedAt,
  };

  const generationDefinitions = [
    {
      id: FOUR_DOOR_GENERATION_ID,
      modelId: MODEL_ID,
      name: "Four-door (2025)",
      aliases: [alias("四门版", SOURCE.fourDoorLaunch)],
      platformCodes: [],
      productionFrom: "2025-02",
      productionTo: null,
      bodyTypes: ["Hatchback"],
      status: "review",
      evidence: [
        ...evidence(SOURCE.fourDoorLaunch, ["name", "productionFrom"], "SGMW launched the named four-door edition on 2025-02-22."),
        ...evidence(SOURCE.fourDoorSpec, ["bodyTypes"], "Hatchback is the normalized body classification for the official four-door passenger-car specification."),
      ],
      researchNotes: ["Edition container used to keep the exact 2025 four-door configuration table together; no internal platform code is inferred."],
      updatedAt: verifiedAt,
    },
    {
      id: FIFTH_GENERATION_ID,
      modelId: MODEL_ID,
      name: "Fifth generation",
      aliases: [alias("第五代", SOURCE.fifthLaunch)],
      platformCodes: ["S"],
      productionFrom: "2026-03",
      productionTo: null,
      bodyTypes: ["Hatchback"],
      status: "review",
      evidence: [
        ...evidence(SOURCE.fifthLaunch, ["name", "productionFrom"], "SGMW identifies the vehicle as the fifth generation and dates its launch to 2026-03-27."),
        ...evidence(SOURCE.fifthTechnical, ["platformCodes", "bodyTypes"], "SGMW identifies the S platform and four-door/four-seat passenger-car body; Hatchback is the normalized public body classification."),
      ],
      researchNotes: ["No unverified internal generation code, battery basis or drivetrain layout is assigned."],
      updatedAt: verifiedAt,
    },
  ];
  const generations = generationDefinitions.filter((generation) => !generationIds.has(generation.id));

  const fourDoorVariants = FOUR_DOOR_VARIANTS
    .filter((definition) => !variantIds.has(`${FOUR_DOOR_GENERATION_ID}/${definition.slug}`))
    .map((definition) => ({
      id: `${FOUR_DOOR_GENERATION_ID}/${definition.slug}`,
      modelId: MODEL_ID,
      generationId: FOUR_DOOR_GENERATION_ID,
      faceliftId: null,
      name: definition.name,
      aliases: [alias(definition.sourceName, SOURCE.fourDoorSpec)],
      market: "China",
      yearFrom: 2025,
      yearTo: null,
      bodyType: "Hatchback",
      powertrainKind: "BEV",
      drive: "RWD",
      motorPeakKw: 30,
      rangeKm: 205,
      rangeStandard: "CLTC",
      lengthMm: 3256,
      widthMm: 1510,
      heightMm: 1578,
      wheelbaseMm: 2190,
      curbWeightKg: 780,
      seats: 4,
      doors: 4,
      topSpeedKmh: 100,
      status: "review",
      evidence: [
        ...evidence(SOURCE.fourDoorLaunch, ["name", "yearFrom"], "Official launch record confirms the exact grade name and 2025 launch year."),
        ...evidence(
          SOURCE.fourDoorSpec,
          ["market", "bodyType", "powertrainKind", "drive", "motorPeakKw", "rangeKm", "rangeStandard", "lengthMm", "widthMm", "heightMm", "wheelbaseMm", "curbWeightKg", "seats", "doors", "topSpeedKmh"],
          "Exact values transcribed from SGMW's three-column four-door table. Rear-mounted rear drive is normalized to RWD; range is explicitly CLTC.",
        ),
      ],
      researchNotes: [
        "The source's 16.2 kWh value is intentionally not assigned to gross, usable or rated battery capacity because its basis is unspecified.",
        "Maximum motor power is stored only as motorPeakKw, never as legal 30-minute power. Pricing production remains disconnected.",
      ],
      updatedAt: verifiedAt,
    }));

  const fifthGenerationVariants = FIFTH_GENERATION_VARIANTS
    .filter((definition) => !variantIds.has(`${FIFTH_GENERATION_ID}/${definition.slug}`))
    .map((definition) => ({
      id: `${FIFTH_GENERATION_ID}/${definition.slug}`,
      modelId: MODEL_ID,
      generationId: FIFTH_GENERATION_ID,
      faceliftId: null,
      name: definition.name,
      aliases: [alias(definition.sourceName, SOURCE.fifthLaunch)],
      market: "China",
      yearFrom: 2026,
      yearTo: null,
      bodyType: "Hatchback",
      powertrainKind: "BEV",
      motorPeakKw: 30,
      rangeKm: definition.rangeKm,
      rangeStandard: "CLTC",
      lengthMm: 3268,
      widthMm: 1520,
      heightMm: 1575,
      seats: 4,
      doors: 4,
      status: "review",
      evidence: [
        ...evidence(SOURCE.fifthLaunch, ["name", "yearFrom"], "Official launch record confirms the exact grade name and 2026 launch year."),
        ...evidence(
          SOURCE.fifthTechnical,
          ["market", "bodyType", "powertrainKind", "motorPeakKw", "rangeKm", "rangeStandard", "lengthMm", "widthMm", "heightMm", "seats", "doors"],
          "Exact values transcribed from SGMW's fifth-generation technical release; range is explicitly CLTC.",
        ),
      ],
      researchNotes: [
        "No battery capacity, wheelbase, curb weight or drivetrain layout is inferred where the cited release does not state an exact value.",
        "Maximum motor power is stored only as motorPeakKw, never as legal 30-minute power. Pricing production remains disconnected.",
      ],
      updatedAt: verifiedAt,
    }));

  const variants = [...fourDoorVariants, ...fifthGenerationVariants];
  const report = {
    schemaVersion: 2,
    generatedAt: verifiedAt,
    productionConnected: false,
    totals: { newSources: sources.length, replacedModels: 1, newGenerations: generations.length, newVariants: variants.length },
    modelId: MODEL_ID,
    generationIds: generationDefinitions.map((record) => record.id),
    variantIds: variants.map((record) => record.id),
    policy: {
      exactManufacturerValuesOnly: true,
      EnglishCanonicalLocalizedAliases: true,
      batteryBasisUnspecifiedAndRejected: true,
      motorPeakNotPower30Min: true,
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
  const { report, ingestion } = await buildWulingHongguangMiniEvGenerationBatch();
  await writeJson(REPORT_FILE, report);
  await writeJson(INGEST_FILE, ingestion);
  console.log(JSON.stringify(report.totals, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
