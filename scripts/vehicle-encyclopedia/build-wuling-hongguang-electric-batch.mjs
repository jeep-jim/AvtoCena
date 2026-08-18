import path from "node:path";
import { pathToFileURL } from "node:url";
import { WORKSPACE_ROOT, loadWorkspace, writeJson } from "./lib.mjs";

const REPORT_FILE = path.join(WORKSPACE_ROOT, "reports/wuling-hongguang-electric-lineup.json");
const INGEST_FILE = path.join(WORKSPACE_ROOT, "ingest/wuling-hongguang-electric-lineup-2026-08-17.json");
const MODEL_ID = "wuling/hongguang";
const BEV_GENERATION_ID = `${MODEL_ID}/bev-2024`;
const EREV_GENERATION_ID = `${MODEL_ID}/erev-2025`;

const SOURCE = {
  bevSpec: "src-sgmw-wuling-hongguang-bev-spec",
  bevLaunchHistory: "src-sgmw-wuling-hongguang-bev-launch-history-2025",
  erevSpec: "src-sgmw-wuling-hongguang-erev-spec",
  erevLaunch: "src-sgmw-wuling-hongguang-erev-launch-2025",
  englishSpec: "src-sgmw-wuling-hongguang-english-spec",
};

const BEV_VARIANTS = [
  { slug: "practical-300-km", sourceName: "纯电动 300km 实用型", name: "Pure Electric 300 km Practical" },
  { slug: "standard-300-km", sourceName: "纯电动 300km 标准型", name: "Pure Electric 300 km Standard" },
];

const EREV_VARIANTS = [
  { slug: "practical-50-km-5-seat", sourceName: "50km实用型", launchName: "实用型-5座", name: "50 km Practical 5-seat", seats: 5, curbWeightKg: 1400, tankCapacityL: 55 },
  { slug: "standard-50-km-5-seat", sourceName: "50km标准型", launchName: "标准型-5座", name: "50 km Standard 5-seat", seats: 5, curbWeightKg: 1400, tankCapacityL: 56 },
  { slug: "comfort-50-km-7-seat", sourceName: "50km舒适型", launchName: "舒适型-7座", name: "50 km Comfort 7-seat", seats: 7, curbWeightKg: 1430, tankCapacityL: 57 },
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

export async function buildWulingHongguangElectricBatch({ verifiedAt = "2026-08-17" } = {}) {
  const workspace = await loadWorkspace();
  const existingModel = workspace.records.model.find((record) => record.id === MODEL_ID);
  if (!existingModel) throw new Error(`${MODEL_ID} is missing`);
  const sourceIds = new Set(workspace.records.source.map((record) => record.id));
  const generationIds = new Set(workspace.records.generation.map((record) => record.id));
  const variantIds = new Set(workspace.records.variant.map((record) => record.id));

  const sourceDefinitions = [
    {
      id: SOURCE.bevSpec,
      type: "manufacturer_technical_document",
      title: "五菱宏光纯电版参数配置",
      publisher: "SAIC-GM-Wuling Automobile Co., Ltd. (SGMW)",
      url: "https://www.sgmw.com.cn/carDetail?id=265",
      documentId: "SGMW carDetail 265",
      documentDate: null,
      verifiedAt,
      market: "China",
      language: "zh-CN",
      supportedFields: [
        "name", "market", "bodyType", "powertrainKind", "motorPeakKw", "rangeKm", "rangeStandard",
        "lengthMm", "widthMm", "heightMm", "wheelbaseMm", "curbWeightKg", "grossWeightKg", "topSpeedKmh",
      ],
      confidence: "official",
      status: "active",
      license: null,
      notes: "Exact two-column manufacturer table. The 32.6 kWh value is not mapped because SGMW does not identify gross, usable or rated battery basis. The 5/6-seat choice cannot be represented as one exact integer and is therefore omitted.",
    },
    {
      id: SOURCE.bevLaunchHistory,
      type: "manufacturer",
      title: "上汽通用五菱：2024年销量超154万辆，新能源同比增长63%",
      publisher: "SAIC-GM-Wuling Automobile Co., Ltd. (SGMW)",
      url: "https://lu.sgmw.com.cn/portal/details.html?id=49099",
      documentId: "SGMW portal 49099",
      documentDate: "2025-01-02",
      verifiedAt,
      market: "China",
      language: "zh-CN",
      supportedFields: ["productionFrom", "yearFrom", "name"],
      confidence: "official",
      status: "active",
      license: null,
      notes: "Official annual record explicitly states that the Hongguang BEV launched in September 2024.",
    },
    {
      id: SOURCE.erevSpec,
      type: "manufacturer_technical_document",
      title: "五菱宏光增程版参数配置",
      publisher: "SAIC-GM-Wuling Automobile Co., Ltd. (SGMW)",
      url: "https://www.sgmw.com.cn/carDetail?id=278",
      documentId: "SGMW carDetail 278",
      documentDate: null,
      verifiedAt,
      market: "China",
      language: "zh-CN",
      supportedFields: [
        "name", "market", "bodyType", "powertrainKind", "fuel", "engineCc", "icePowerKw", "drive",
        "motorPeakKw", "rangeKm", "rangeStandard", "lengthMm", "widthMm", "heightMm", "wheelbaseMm",
        "curbWeightKg", "grossWeightKg", "tankCapacityL", "seats", "topSpeedKmh",
      ],
      confidence: "official",
      status: "active",
      license: null,
      notes: "Exact three-column manufacturer table. The 8.5 kWh value is not mapped because SGMW does not identify gross, usable or rated battery basis. The stated 1,000 km combined range has no matching V2 field and is not substituted for electric range.",
    },
    {
      id: SOURCE.erevLaunch,
      type: "manufacturer",
      title: "6.88万元起！全球首款6万级增程后驱MPV五菱宏光增程版正式上市",
      publisher: "SAIC-GM-Wuling Automobile Co., Ltd. (SGMW)",
      url: "https://lu.sgmw.com.cn/portal/details.html?id=50299",
      documentId: "SGMW portal 50299",
      documentDate: "2025-04-09",
      verifiedAt,
      market: "China",
      language: "zh-CN",
      supportedFields: ["canonicalName", "productionFrom", "bodyTypes", "powertrainKinds", "name", "yearFrom", "bodyType", "powertrainKind", "drive", "motorPeakKw", "seats"],
      confidence: "official",
      status: "active",
      license: null,
      notes: "Official launch identifies the Hongguang family as originating in 2010, the 2024 BEV, the 2025 EREV, the MPV body, rear-wheel drive and exact three-seat-layout grade names.",
    },
    {
      id: SOURCE.englishSpec,
      type: "manufacturer_technical_document",
      title: "Hongguang Specifications",
      publisher: "SAIC-GM-Wuling Automobile Co., Ltd. (SGMW)",
      url: "https://www.sgmw.com.cn/en/carDetail?id=5",
      documentId: "SGMW English carDetail 5",
      documentDate: null,
      verifiedAt,
      market: "China",
      language: "en",
      supportedFields: ["drive"],
      confidence: "official",
      status: "active",
      license: null,
      notes: "Official English specification identifies both EV and REEV columns as FR; this is normalized to RWD only. Its differently scoped REEV range row is not used for the China grade variants.",
    },
  ];
  const sources = sourceDefinitions.filter((source) => !sourceIds.has(source.id));

  const replacementModel = {
    ...existingModel,
    productionFrom: "2010",
    bodyTypes: ["MPV"],
    powertrainKinds: ["BEV", "EREV"],
    evidence: [
      ...existingModel.evidence,
      ...evidence(SOURCE.erevLaunch, ["productionFrom", "bodyTypes", "powertrainKinds"], "Official launch history dates the Hongguang family to 2010 and explicitly describes its 2024 BEV and 2025 EREV MPV forms."),
    ],
    researchNotes: [
      ...existingModel.researchNotes,
      "The 2024 BEV and 2025 EREV source-backed configurations are staged below; publication and pricing remain disconnected.",
    ],
    updatedAt: verifiedAt,
  };

  const generationDefinitions = [
    {
      id: BEV_GENERATION_ID,
      modelId: MODEL_ID,
      name: "BEV (2024)",
      aliases: [alias("纯电版", SOURCE.bevSpec)],
      platformCodes: [],
      productionFrom: "2024-09",
      productionTo: null,
      bodyTypes: ["MPV"],
      status: "review",
      evidence: [
        ...evidence(SOURCE.bevLaunchHistory, ["name", "productionFrom"], "SGMW states that the Hongguang BEV launched in September 2024."),
        ...evidence(SOURCE.erevLaunch, ["bodyTypes"], "SGMW's family history identifies the Hongguang body as a compact MPV and names the 2024 BEV transformation."),
      ],
      researchNotes: ["Powertrain-edition container; no unverified platform code or internal generation code is inferred."],
      updatedAt: verifiedAt,
    },
    {
      id: EREV_GENERATION_ID,
      modelId: MODEL_ID,
      name: "EREV (2025)",
      aliases: [alias("增程版", SOURCE.erevLaunch)],
      platformCodes: [],
      productionFrom: "2025-04",
      productionTo: null,
      bodyTypes: ["MPV"],
      status: "review",
      evidence: evidence(SOURCE.erevLaunch, ["name", "productionFrom", "bodyTypes"], "SGMW launched the named rear-wheel-drive EREV MPV on 2025-04-09."),
      researchNotes: ["Powertrain-edition container; no unverified platform code or internal generation code is inferred."],
      updatedAt: verifiedAt,
    },
  ];
  const generations = generationDefinitions.filter((generation) => !generationIds.has(generation.id));

  const bevVariants = BEV_VARIANTS
    .filter((definition) => !variantIds.has(`${BEV_GENERATION_ID}/${definition.slug}`))
    .map((definition) => ({
      id: `${BEV_GENERATION_ID}/${definition.slug}`,
      modelId: MODEL_ID,
      generationId: BEV_GENERATION_ID,
      faceliftId: null,
      name: definition.name,
      aliases: [alias(definition.sourceName, SOURCE.bevSpec)],
      market: "China",
      yearFrom: 2024,
      yearTo: null,
      bodyType: "MPV",
      powertrainKind: "BEV",
      drive: "RWD",
      motorPeakKw: 75,
      rangeKm: 300,
      rangeStandard: "CLTC",
      lengthMm: 4515,
      widthMm: 1725,
      heightMm: 1790,
      wheelbaseMm: 2850,
      curbWeightKg: 1275,
      grossWeightKg: 1850,
      topSpeedKmh: 135,
      status: "review",
      evidence: [
        ...evidence(SOURCE.bevLaunchHistory, ["yearFrom"], "SGMW explicitly records the September 2024 launch."),
        ...evidence(SOURCE.erevLaunch, ["bodyType"], "SGMW identifies the Hongguang family body as an MPV and explicitly references the 2024 BEV."),
        ...evidence(SOURCE.englishSpec, ["drive"], "The official English table identifies the EV driving type as FR, normalized to RWD."),
        ...evidence(
          SOURCE.bevSpec,
          ["name", "market", "powertrainKind", "motorPeakKw", "rangeKm", "rangeStandard", "lengthMm", "widthMm", "heightMm", "wheelbaseMm", "curbWeightKg", "grossWeightKg", "topSpeedKmh"],
          "Exact values transcribed column-for-column from SGMW's two-column China BEV specification.",
        ),
      ],
      researchNotes: [
        "The 32.6 kWh source value is intentionally not assigned to gross, usable or rated battery capacity because its basis is unspecified.",
        "The source offers 5/6-seat layouts within each grade, so no single seats integer is invented. Maximum motor power is never reused as legal 30-minute power.",
      ],
      updatedAt: verifiedAt,
    }));

  const erevVariants = EREV_VARIANTS
    .filter((definition) => !variantIds.has(`${EREV_GENERATION_ID}/${definition.slug}`))
    .map((definition) => ({
      id: `${EREV_GENERATION_ID}/${definition.slug}`,
      modelId: MODEL_ID,
      generationId: EREV_GENERATION_ID,
      faceliftId: null,
      name: definition.name,
      aliases: [alias(definition.sourceName, SOURCE.erevSpec), alias(definition.launchName, SOURCE.erevLaunch)],
      market: "China",
      yearFrom: 2025,
      yearTo: null,
      bodyType: "MPV",
      powertrainKind: "EREV",
      fuel: "Petrol",
      engineCc: 1498,
      icePowerKw: 73,
      drive: "RWD",
      motorPeakKw: 75,
      rangeKm: 50,
      rangeStandard: "CLTC",
      lengthMm: 4515,
      widthMm: 1725,
      heightMm: 1790,
      wheelbaseMm: 2850,
      curbWeightKg: definition.curbWeightKg,
      grossWeightKg: 1990,
      tankCapacityL: definition.tankCapacityL,
      seats: definition.seats,
      topSpeedKmh: 135,
      status: "review",
      evidence: [
        ...evidence(SOURCE.erevLaunch, ["name", "yearFrom", "bodyType"], "Official launch record confirms the exact seat-layout grade, 2025 launch year and MPV body."),
        ...evidence(
          SOURCE.erevSpec,
          ["market", "powertrainKind", "fuel", "engineCc", "icePowerKw", "drive", "motorPeakKw", "rangeKm", "rangeStandard", "lengthMm", "widthMm", "heightMm", "wheelbaseMm", "curbWeightKg", "grossWeightKg", "tankCapacityL", "seats", "topSpeedKmh"],
          "Exact values transcribed column-for-column from SGMW's three-column China EREV specification; rear drive is normalized to RWD.",
        ),
      ],
      researchNotes: [
        "The 8.5 kWh source value is intentionally not assigned to gross, usable or rated battery capacity because its basis is unspecified.",
        "The 1,000 km combined range is retained only in source notes; rangeKm stores the exact 50 km CLTC electric range. Maximum motor power is never reused as legal 30-minute power.",
      ],
      updatedAt: verifiedAt,
    }));

  const variants = [...bevVariants, ...erevVariants];
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
      multiSeatChoiceNotCollapsed: true,
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
  const { report, ingestion } = await buildWulingHongguangElectricBatch();
  await writeJson(REPORT_FILE, report);
  await writeJson(INGEST_FILE, ingestion);
  console.log(JSON.stringify(report.totals, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
