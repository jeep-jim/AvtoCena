import path from "node:path";
import { pathToFileURL } from "node:url";
import { WORKSPACE_ROOT, loadWorkspace, writeJson } from "./lib.mjs";

const REPORT_FILE = path.join(WORKSPACE_ROOT, "reports/wuling-air-ev-2022-lineup.json");
const INGEST_FILE = path.join(WORKSPACE_ROOT, "ingest/wuling-air-ev-2022-lineup-2026-08-18.json");
const MODEL_ID = "wuling/air-ev";
const GENERATION_ID = `${MODEL_ID}/china-launch-2022`;
const EN_LAUNCH_SOURCE_ID = "src-gm-wuling-air-ev-china-launch-en-2022";
const ZH_LAUNCH_SOURCE_ID = "src-gm-wuling-air-ev-china-launch-zh-2022";
const PRODUCTION_SOURCE_ID = "src-gm-wuling-air-ev-china-production-en-2022";
const BODY_SOURCE_ID = "src-wuling-indonesia-new-air-ev-launch-en-2025";

const VARIANTS = [
  { slug: "2-seat-standard", sourceName: "两座版 标准版", name: "2-seat Standard", seats: 2, motorPeakKw: 30 },
  { slug: "2-seat-advanced", sourceName: "两座版 进阶版", name: "2-seat Advanced", seats: 2, motorPeakKw: 30 },
  { slug: "4-seat-standard", sourceName: "四座版 标准版", name: "4-seat Standard", seats: 4, motorPeakKw: 50 },
  { slug: "4-seat-advanced", sourceName: "四座版 进阶版", name: "4-seat Advanced", seats: 4, motorPeakKw: 50 },
];

function chunk(entityType, records) {
  return { schemaVersion: 2, entityType, chunk: 1, maxRecords: 250, records };
}

function evidence(sourceId, fields, note) {
  return [{ sourceId, fields, status: "verified", confidence: "official", note }];
}

function alias(value) {
  return { value, kind: "localized", safe: true, language: "zh-CN", market: "China", sourceIds: [ZH_LAUNCH_SOURCE_ID] };
}

export async function buildWulingAirEv2022Batch({ verifiedAt = "2026-08-18" } = {}) {
  const workspace = await loadWorkspace();
  const existingModel = workspace.records.model.find((record) => record.id === MODEL_ID);
  if (!existingModel) throw new Error(`${MODEL_ID} is missing`);
  const sourceIds = new Set(workspace.records.source.map((record) => record.id));
  const generationIds = new Set(workspace.records.generation.map((record) => record.id));
  const variantIds = new Set(workspace.records.variant.map((record) => record.id));

  const sourceDefinitions = [
    {
      id: EN_LAUNCH_SOURCE_ID,
      type: "manufacturer",
      title: "SAIC-GM-Wuling Launches Wuling Air EV in China",
      publisher: "General Motors / SAIC-GM-Wuling",
      url: "https://news.gm.com.cn/en/home.detail.html/Pages/news/cn/en/2022/Dec/1212-wuling.html",
      documentId: "GM China Wuling Air EV 2022-12-12 EN",
      documentDate: "2022-12-12",
      verifiedAt,
      market: "China",
      language: "en",
      supportedFields: [
        "canonicalName", "productionFrom", "powertrainKinds", "name", "market", "yearFrom",
        "powertrainKind", "rangeKm", "rangeStandard", "lengthMm", "widthMm", "heightMm",
        "wheelbaseMm", "seats",
      ],
      confidence: "official",
      status: "active",
      license: null,
      notes: "Official English launch establishes the Air EV public name, four China launch variants, two- and four-seat editions, 300 km CLTC range and exact dimensions for the four-seat edition. It also records the earlier August 2022 Indonesia launch.",
    },
    {
      id: ZH_LAUNCH_SOURCE_ID,
      type: "manufacturer",
      title: "售价6.78 万至8.28 万元 胡歌携五菱新能源首款全球车Air ev晴空上市",
      publisher: "General Motors / SAIC-GM-Wuling",
      url: "https://news.gm.com.cn/zh/home.detail.html/Pages/news/cn/zh/2022/Dec/1212-wuling.html",
      documentId: "GM China Wuling Air ev晴空 2022-12-12 ZH",
      documentDate: "2022-12-12",
      verifiedAt,
      market: "China",
      language: "zh-CN",
      supportedFields: ["name", "market", "yearFrom", "powertrainKind", "rangeKm", "rangeStandard", "seats"],
      confidence: "official",
      status: "active",
      license: null,
      notes: "Official Chinese launch explicitly names Standard and Advanced grades for both the two-seat and four-seat editions and states that all four have 300 km range.",
    },
    {
      id: PRODUCTION_SOURCE_ID,
      type: "manufacturer",
      title: "SAIC-GM-Wuling Marks 20 Years with New Plant Groundbreaking and New NEV",
      publisher: "General Motors / SAIC-GM-Wuling",
      url: "https://news.gm.com.cn/en/home.detail.html/Pages/news/cn/en/2022/Nov/1118-wuling.html",
      documentId: "GM China Wuling Air EV production 2022-11-18 EN",
      documentDate: "2022-11-18",
      verifiedAt,
      market: "China",
      language: "en",
      supportedFields: ["motorPeakKw", "seats"],
      confidence: "official",
      status: "active",
      license: null,
      notes: "Official production release assigns 30 kW and 50 kW drive motors to the two-seat and four-seat editions respectively. Maximum motor power is never reused as legal 30-minute power.",
    },
    {
      id: BODY_SOURCE_ID,
      type: "manufacturer",
      title: "Wuling Launches New Air ev and New Cloud EV at Indonesia International Motor Show 2025",
      publisher: "PT SGMW Motor Indonesia (Wuling Motors)",
      url: "https://wuling.id/en/blog/press-release/wuling-launches-new-air-ev-and-new-cloud-ev-at-indonesia-international-motor-show-2025",
      documentId: "Wuling Indonesia New Air ev launch 2025-02-13 EN",
      documentDate: "2025-02-13",
      verifiedAt,
      market: "Indonesia",
      language: "en",
      supportedFields: ["bodyTypes", "bodyType"],
      confidence: "official",
      status: "active",
      license: null,
      notes: "Wuling's official English release directly classifies the Air ev as a compact city car. The normalized V2 body label is City car.",
    },
  ];
  const sources = sourceDefinitions.filter((source) => !sourceIds.has(source.id));

  const sourceNames = [...existingModel.sourceNames];
  if (!sourceNames.some((record) => record.value === "Air ev晴空")) {
    sourceNames.push({
      value: "Air ev晴空",
      kind: "localized",
      safe: true,
      language: "zh-CN",
      market: "China",
      sourceIds: [ZH_LAUNCH_SOURCE_ID],
    });
  }

  const replacementModel = {
    ...existingModel,
    canonicalName: "Air EV",
    sourceNames,
    productionFrom: "2022-08",
    bodyTypes: ["City car"],
    powertrainKinds: ["BEV"],
    evidence: [
      ...existingModel.evidence,
      ...evidence(EN_LAUNCH_SOURCE_ID, ["canonicalName", "productionFrom", "powertrainKinds"], "Official English release uses Air EV, records the first Indonesia launch in August 2022 and identifies the vehicle as battery electric."),
      ...evidence(BODY_SOURCE_ID, ["bodyTypes"], "Wuling directly classifies Air ev as a compact city car."),
    ],
    researchNotes: [
      ...existingModel.researchNotes,
      "All four official 2022 China launch configurations are staged below; publication and pricing remain disconnected.",
    ],
    updatedAt: verifiedAt,
  };

  const generations = generationIds.has(GENERATION_ID) ? [] : [{
    id: GENERATION_ID,
    modelId: MODEL_ID,
    name: "China launch lineup (2022)",
    aliases: [alias("Air ev晴空")],
    platformCodes: [],
    productionFrom: "2022-12",
    productionTo: null,
    bodyTypes: ["City car"],
    status: "review",
    evidence: [
      ...evidence(EN_LAUNCH_SOURCE_ID, ["name", "productionFrom"], "Official China release dates the four-variant launch to 2022-12-12."),
      ...evidence(BODY_SOURCE_ID, ["bodyTypes"], "Wuling's public English classification is compact city car."),
    ],
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
        yearFrom: 2022,
        yearTo: null,
        bodyType: "City car",
        powertrainKind: "BEV",
        motorPeakKw: definition.motorPeakKw,
        rangeKm: 300,
        rangeStandard: "CLTC",
        seats: definition.seats,
        status: "review",
        evidence: [
          ...evidence(EN_LAUNCH_SOURCE_ID, ["market", "yearFrom", "powertrainKind", "rangeKm", "rangeStandard", "seats", ...(definition.seats === 4 ? ["lengthMm", "widthMm", "heightMm", "wheelbaseMm"] : [])], "Official English launch supplies the China-market date, seating edition, 300 km CLTC range and, for four-seat editions only, exact dimensions."),
          ...evidence(ZH_LAUNCH_SOURCE_ID, ["name", "market", "yearFrom", "powertrainKind", "rangeKm", "rangeStandard", "seats"], "Official Chinese launch distinguishes Standard and Advanced grades within the two-seat and four-seat editions."),
          ...evidence(PRODUCTION_SOURCE_ID, ["motorPeakKw", "seats"], "Official production release assigns 30 kW to two-seat editions and 50 kW to four-seat editions."),
          ...evidence(BODY_SOURCE_ID, ["bodyType"], "Wuling's public English classification is compact city car."),
        ],
        researchNotes: [
          "Peak drive-motor output is not reused as legal 30-minute power.",
          "Battery capacity and charging power remain empty because the launch releases do not provide an explicit capacity basis or charging-kW value.",
        ],
        updatedAt: verifiedAt,
      };
      if (definition.seats === 4) {
        record.lengthMm = 2974;
        record.widthMm = 1505;
        record.heightMm = 1631;
        record.wheelbaseMm = 2010;
      }
      return record;
    });

  const report = {
    schemaVersion: 2,
    generatedAt: verifiedAt,
    productionConnected: false,
    totals: { newSources: sources.length, replacedModels: 1, newGenerations: generations.length, newVariants: variants.length },
    modelId: MODEL_ID,
    canonicalName: "Air EV",
    generationIds: [GENERATION_ID],
    variantIds: variants.map((record) => record.id),
    policy: {
      officialEnglishCanonicalName: true,
      exactManufacturerGradesOnly: true,
      localizedSourceNamesRetainedAsAliases: true,
      fourSeatDimensionsNotCopiedToTwoSeatEditions: true,
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
  const { report, ingestion } = await buildWulingAirEv2022Batch();
  await writeJson(REPORT_FILE, report);
  await writeJson(INGEST_FILE, ingestion);
  console.log(JSON.stringify(report.totals, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
