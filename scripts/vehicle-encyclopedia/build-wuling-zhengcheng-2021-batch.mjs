import path from "node:path";
import { pathToFileURL } from "node:url";
import { WORKSPACE_ROOT, loadWorkspace, writeJson } from "./lib.mjs";

const REPORT_FILE = path.join(WORKSPACE_ROOT, "reports/wuling-zhengcheng-2021-specifications.json");
const INGEST_FILE = path.join(WORKSPACE_ROOT, "ingest/wuling-zhengcheng-2021-specifications-2026-08-17.json");
const MODEL_ID = "wuling/zhengcheng";
const GENERATION_ID = `${MODEL_ID}/launch-2021`;
const EN_SOURCE_ID = "src-gm-wuling-zhengcheng-launch-en-2021";
const ZH_SOURCE_ID = "src-gm-wuling-zhengcheng-launch-zh-2021";
const SPEC_SOURCE_ID = "src-sgmw-wuling-zhengcheng-spec";

const VARIANTS = [
  {
    slug: "1-5t-6mt-comfort-window-van-2-seat",
    sourceName: "1.5T MT手动挡舒适型封窗车",
    name: "1.5T 6MT Comfort Window Van 2-seat",
    bodyType: "Van",
    heightMm: 1910,
    curbWeightKg: 1475,
    seats: 2,
    topSpeedKmh: 165,
  },
  {
    slug: "1-5t-6mt-comfort-7-seat",
    sourceName: "1.5T MT手动挡舒适型",
    name: "1.5T 6MT Comfort 7-seat",
    bodyType: "MPV",
    heightMm: 1895,
    seats: 7,
    topSpeedKmh: 165,
  },
  {
    slug: "1-5t-6mt-luxury-7-seat",
    sourceName: "1.5T MT手动挡豪华型",
    name: "1.5T 6MT Luxury 7-seat",
    bodyType: "MPV",
    heightMm: 1895,
    seats: 7,
    topSpeedKmh: 165,
  },
  {
    slug: "1-5t-6mt-luxury-commercial-7-seat",
    sourceName: "1.5T MT手动挡豪华型营运车",
    name: "1.5T 6MT Luxury Commercial 7-seat",
    bodyType: "MPV",
    heightMm: 1895,
    seats: 7,
  },
];

function chunk(entityType, records) {
  return { schemaVersion: 2, entityType, chunk: 1, maxRecords: 250, records };
}

function evidence(sourceId, fields, note) {
  return [{ sourceId, fields, status: "verified", confidence: "official", note }];
}

function alias(value) {
  return { value, kind: "localized", safe: true, language: "zh-CN", market: "China", sourceIds: [SPEC_SOURCE_ID] };
}

export async function buildWulingZhengcheng2021Batch({ verifiedAt = "2026-08-17" } = {}) {
  const workspace = await loadWorkspace();
  const existingModel = workspace.records.model.find((record) => record.id === MODEL_ID);
  if (!existingModel) throw new Error(`${MODEL_ID} is missing`);
  const sourceIds = new Set(workspace.records.source.map((record) => record.id));
  const generationIds = new Set(workspace.records.generation.map((record) => record.id));
  const variantIds = new Set(workspace.records.variant.map((record) => record.id));

  const sourceDefinitions = [
    {
      id: EN_SOURCE_ID,
      type: "manufacturer",
      title: "Wuling Launches Zhengcheng MPV",
      publisher: "General Motors / SAIC-GM-Wuling",
      url: "https://news.gm.com.cn/en/home.detail.html/Pages/news/cn/en/2021/Aug/0830-wuling-zhengcheng.html",
      documentId: "GM China Wuling Zhengcheng 2021-08-30 EN",
      documentDate: "2021-08-30",
      verifiedAt,
      market: "China",
      language: "en",
      supportedFields: ["canonicalName", "productionFrom", "bodyTypes", "powertrainKinds", "name", "yearFrom", "market", "bodyType", "powertrainKind", "fuel", "transmission", "gears", "icePowerKw", "lengthMm", "widthMm", "heightMm", "wheelbaseMm", "seats"],
      confidence: "official",
      status: "active",
      license: null,
      notes: "Official English launch establishes the Zhengcheng name, 2021 MPV launch, 1.5T six-speed manual powertrain, 108 kW maximum engine power, shared dimensions and the four launch-version seating roles.",
    },
    {
      id: ZH_SOURCE_ID,
      type: "manufacturer",
      title: "五菱征程正式上市 7.58万元起",
      publisher: "General Motors / SAIC-GM-Wuling",
      url: "https://news.gm.com.cn/zh/home.detail.html/Pages/news/cn/zh/2021/Aug/0830-wuling-zhengcheng.html",
      documentId: "GM China Wuling Zhengcheng 2021-08-30 ZH",
      documentDate: "2021-08-30",
      verifiedAt,
      market: "China",
      language: "zh-CN",
      supportedFields: ["name", "yearFrom", "bodyType", "powertrainKind", "fuel", "transmission", "gears", "icePowerKw", "lengthMm", "seats"],
      confidence: "official",
      status: "active",
      license: null,
      notes: "Official Chinese launch distinguishes Comfort, Luxury, Comfort Window Van and Luxury Commercial variants, including their base seating layouts and optional 8/9-seat upgrades.",
    },
    {
      id: SPEC_SOURCE_ID,
      type: "manufacturer_technical_document",
      title: "五菱征程参数配置",
      publisher: "SAIC-GM-Wuling Automobile Co., Ltd. (SGMW)",
      url: "https://www.sgmw.com.cn/carDetail?id=62",
      documentId: "SGMW carDetail 62",
      documentDate: null,
      verifiedAt,
      market: "China",
      language: "zh-CN",
      supportedFields: ["name", "market", "bodyType", "powertrainKind", "fuel", "engineCc", "transmission", "drive", "icePowerKw", "lengthMm", "widthMm", "heightMm", "wheelbaseMm", "curbWeightKg", "tankCapacityL", "seats", "topSpeedKmh"],
      confidence: "official",
      status: "active",
      license: null,
      notes: "Exact four-column manufacturer table. Passenger curb-weight cells contain several values that are not assigned to individual seating choices, and the commercial top-speed cell is ambiguous, so those fields are left unset where necessary.",
    },
  ];
  const sources = sourceDefinitions.filter((source) => !sourceIds.has(source.id));

  const replacementModel = {
    ...existingModel,
    productionFrom: "2021-08",
    bodyTypes: ["MPV", "Van"],
    powertrainKinds: [...new Set([...existingModel.powertrainKinds, "ICE"])],
    evidence: [
      ...existingModel.evidence,
      ...evidence(EN_SOURCE_ID, ["canonicalName", "productionFrom", "bodyTypes", "powertrainKinds"], "Official English release uses Zhengcheng and establishes the August 2021 ICE MPV launch; the official lineup also includes a cargo window-van body."),
    ],
    researchNotes: [
      ...existingModel.researchNotes,
      "Official 2021 English and Chinese launches plus the current technical table establish the four launch configurations below.",
    ],
    updatedAt: verifiedAt,
  };

  const generations = generationIds.has(GENERATION_ID) ? [] : [{
    id: GENERATION_ID,
    modelId: MODEL_ID,
    name: "Launch lineup (2021)",
    aliases: [],
    platformCodes: [],
    productionFrom: "2021-08",
    productionTo: null,
    bodyTypes: ["MPV", "Van"],
    status: "review",
    evidence: evidence(EN_SOURCE_ID, ["name", "productionFrom", "bodyTypes"], "Official release records the Zhengcheng MPV launch and its cargo-oriented commercial version on 2021-08-30."),
    researchNotes: ["Launch-lineup container only; no unverified platform or internal generation code is inferred."],
    updatedAt: verifiedAt,
  }];

  const variants = VARIANTS
    .filter((definition) => !variantIds.has(`${GENERATION_ID}/${definition.slug}`))
    .map((definition) => {
      const record = {
        id: `${GENERATION_ID}/${definition.slug}`,
        modelId: MODEL_ID,
        generationId: GENERATION_ID,
        faceliftId: null,
        name: definition.name,
        aliases: [alias(definition.sourceName)],
        market: "China",
        yearFrom: 2021,
        yearTo: null,
        bodyType: definition.bodyType,
        powertrainKind: "ICE",
        fuel: "Petrol",
        engineCc: 1451,
        transmission: "6-speed manual",
        gears: 6,
        drive: "RWD",
        icePowerKw: 108,
        lengthMm: 5150,
        widthMm: 1840,
        heightMm: definition.heightMm,
        wheelbaseMm: 3180,
        tankCapacityL: 53,
        seats: definition.seats,
        status: "review",
        evidence: [
          ...evidence(EN_SOURCE_ID, ["yearFrom", "market", "powertrainKind", "transmission", "gears", "icePowerKw", "lengthMm", "widthMm", "wheelbaseMm", ...(definition.bodyType === "MPV" ? ["bodyType", "heightMm"] : [])], "Official English launch supplies the China-market date, 1.5T six-speed manual powertrain, 108 kW maximum power and shared dimensions; its 1,895 mm height applies to the MPV configurations."),
          ...evidence(ZH_SOURCE_ID, ["name", "yearFrom", "bodyType", "powertrainKind", "transmission", "gears", "icePowerKw", "lengthMm", "seats"], "Official Chinese launch distinguishes the four configurations and their base seating layouts; optional 8/9-seat upgrades are not collapsed into the seven-seat records."),
          ...evidence(SPEC_SOURCE_ID, ["name", "market", "bodyType", "powertrainKind", "fuel", "engineCc", "transmission", "drive", "icePowerKw", "lengthMm", "widthMm", "heightMm", "wheelbaseMm", "tankCapacityL", "seats", ...(definition.curbWeightKg ? ["curbWeightKg"] : []), ...(definition.topSpeedKmh ? ["topSpeedKmh"] : [])], "Exact manufacturer-table values are transcribed column-for-column; 1.451 L is normalized to the exact equivalent 1,451 cm³ and front-engine/rear-wheel drive to RWD."),
        ],
        researchNotes: [
          "Passenger curb weight is not stored because the current table lists multiple values without assigning one to each seat layout.",
          "No horsepower value is calculated from kW.",
        ],
        updatedAt: verifiedAt,
      };
      if (definition.curbWeightKg) record.curbWeightKg = definition.curbWeightKg;
      if (definition.topSpeedKmh) record.topSpeedKmh = definition.topSpeedKmh;
      return record;
    });

  const report = {
    schemaVersion: 2,
    generatedAt: verifiedAt,
    productionConnected: false,
    totals: { newSources: sources.length, replacedModels: 1, newGenerations: generations.length, newVariants: variants.length },
    modelId: MODEL_ID,
    canonicalName: "Zhengcheng",
    generationIds: [GENERATION_ID],
    variantIds: variants.map((record) => record.id),
    policy: {
      officialEnglishCanonicalName: true,
      exactManufacturerValuesOnly: true,
      localizedSourceNamesRetainedAsAliases: true,
      unassignedSeatWeightChoicesNotCollapsed: true,
      ambiguousCommercialTopSpeedNotStored: true,
      horsepowerNotCalculated: true,
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
  const { report, ingestion } = await buildWulingZhengcheng2021Batch();
  await writeJson(REPORT_FILE, report);
  await writeJson(INGEST_FILE, ingestion);
  console.log(JSON.stringify(report.totals, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
