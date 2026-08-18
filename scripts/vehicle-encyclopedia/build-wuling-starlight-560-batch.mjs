import path from "node:path";
import { pathToFileURL } from "node:url";
import { WORKSPACE_ROOT, loadWorkspace, writeJson } from "./lib.mjs";

const REPORT_FILE = path.join(WORKSPACE_ROOT, "reports/wuling-starlight-560-lineup.json");
const INGEST_FILE = path.join(WORKSPACE_ROOT, "ingest/wuling-starlight-560-lineup-2026-08-17.json");
const MODEL_ID = "wuling/starlight-560";
const GENERATION_ID = `${MODEL_ID}/launch-lineup-2026`;
const ENGLISH_SOURCE_ID = "src-sgmw-wuling-silver-current-2026";
const LAUNCH_SOURCE_ID = "src-sgmw-wuling-starlight-560-launch-2026";

const VARIANTS = [
  {
    slug: "fuel-1-5t-6mt-comfort",
    sourceName: "燃油1.5T 6MT舒适型",
    name: "Fuel 1.5T 6MT Comfort",
    kind: "ICE",
    transmission: "6-speed manual",
    gears: 6,
  },
  {
    slug: "fuel-1-5t-cvt-elite",
    sourceName: "燃油1.5T CVT精英型",
    name: "Fuel 1.5T CVT Elite",
    kind: "ICE",
    transmission: "CVT",
  },
  {
    slug: "phev-125-km-luxury",
    sourceName: "插混125km豪华型",
    name: "PHEV 125 km Luxury",
    kind: "PHEV",
    rangeKm: 125,
  },
  {
    slug: "bev-500-km-luxury",
    sourceName: "纯电500km豪华型",
    name: "BEV 500 km Luxury",
    kind: "BEV",
    rangeKm: 500,
    rangeStandard: "CLTC",
  },
];

function chunk(entityType, records) {
  return { schemaVersion: 2, entityType, chunk: 1, maxRecords: 250, records };
}

function evidence(sourceId, fields, note) {
  return [{ sourceId, fields, status: "verified", confidence: "official", note }];
}

function alias(value) {
  return {
    value,
    kind: "localized",
    safe: true,
    language: "zh-CN",
    market: "China",
    sourceIds: [LAUNCH_SOURCE_ID],
  };
}

export async function buildWulingStarlight560Batch({ verifiedAt = "2026-08-17" } = {}) {
  const workspace = await loadWorkspace();
  const existingModel = workspace.records.model.find((record) => record.id === MODEL_ID);
  if (!existingModel) throw new Error(`${MODEL_ID} is missing`);
  const sourceIds = new Set(workspace.records.source.map((record) => record.id));
  const generationIds = new Set(workspace.records.generation.map((record) => record.id));
  const variantIds = new Set(workspace.records.variant.map((record) => record.id));

  const sourceDefinitions = [
    {
      id: ENGLISH_SOURCE_ID,
      type: "manufacturer",
      title: "Wuling Silver current model range",
      publisher: "SAIC-GM-Wuling Automobile Co., Ltd. (SGMW)",
      url: "https://www.sgmw.com.cn/en/wulingSilver",
      documentId: "SGMW Wuling Silver",
      documentDate: null,
      verifiedAt,
      market: "China",
      language: "en",
      supportedFields: ["canonicalName"],
      confidence: "official",
      status: "active",
      license: null,
      notes: "The manufacturer's English portfolio explicitly publishes the model as Starlight 560.",
    },
    {
      id: LAUNCH_SOURCE_ID,
      type: "manufacturer",
      title: "5.98万元起！星光560正式上市，让生活“大有奔头”",
      publisher: "SAIC-GM-Wuling Automobile Co., Ltd. (SGMW)",
      url: "https://lu.sgmw.com.cn/portal/details.html?id=54483",
      documentId: "SGMW portal 54483",
      documentDate: "2026-01-16",
      verifiedAt,
      market: "China",
      language: "zh-CN",
      supportedFields: [
        "productionFrom", "bodyTypes", "powertrainKinds", "name", "market", "yearFrom",
        "bodyType", "powertrainKind", "transmission", "gears", "rangeKm", "rangeStandard",
      ],
      confidence: "official",
      status: "active",
      license: null,
      notes: "Official launch release states sales began on 2026-01-15, identifies the model as an SUV, and names all four ICE, PHEV and BEV configurations. Only explicitly stated range standards are mapped.",
    },
  ];
  const sources = sourceDefinitions.filter((source) => !sourceIds.has(source.id));

  const replacementModel = {
    ...existingModel,
    productionFrom: "2026-01",
    bodyTypes: ["SUV"],
    powertrainKinds: ["ICE", "PHEV", "BEV"],
    evidence: [
      ...existingModel.evidence,
      ...evidence(ENGLISH_SOURCE_ID, ["canonicalName"], "SGMW's English model range explicitly uses Starlight 560."),
      ...evidence(LAUNCH_SOURCE_ID, ["productionFrom", "bodyTypes", "powertrainKinds"], "SGMW records the 2026-01-15 launch of the SUV with ICE, PHEV and BEV choices."),
    ],
    researchNotes: [
      ...existingModel.researchNotes,
      "The complete four-grade launch identity is staged below; absent technical values remain empty until a manufacturer table is available.",
    ],
    updatedAt: verifiedAt,
  };

  const generations = generationIds.has(GENERATION_ID) ? [] : [{
    id: GENERATION_ID,
    modelId: MODEL_ID,
    name: "Launch lineup (2026)",
    aliases: [],
    platformCodes: [],
    productionFrom: "2026-01",
    productionTo: null,
    bodyTypes: ["SUV"],
    status: "review",
    evidence: evidence(LAUNCH_SOURCE_ID, ["name", "productionFrom", "bodyTypes"], "Manufacturer launch record confirms the January 2026 SUV lineup."),
    researchNotes: ["Launch-lineup container only; no unverified platform or internal generation code is inferred."],
    updatedAt: verifiedAt,
  }];

  const variants = VARIANTS
    .filter((definition) => !variantIds.has(`${GENERATION_ID}/${definition.slug}`))
    .map((definition) => {
      const fields = ["name", "market", "yearFrom", "bodyType", "powertrainKind"];
      if (definition.transmission) fields.push("transmission");
      if (definition.gears) fields.push("gears");
      if (definition.rangeKm) fields.push("rangeKm");
      if (definition.rangeStandard) fields.push("rangeStandard");
      return {
        id: `${GENERATION_ID}/${definition.slug}`,
        modelId: MODEL_ID,
        generationId: GENERATION_ID,
        faceliftId: null,
        name: definition.name,
        aliases: [alias(definition.sourceName)],
        market: "China",
        yearFrom: 2026,
        yearTo: null,
        bodyType: "SUV",
        powertrainKind: definition.kind,
        ...(definition.transmission ? { transmission: definition.transmission } : {}),
        ...(definition.gears ? { gears: definition.gears } : {}),
        ...(definition.rangeKm ? { rangeKm: definition.rangeKm } : {}),
        ...(definition.rangeStandard ? { rangeStandard: definition.rangeStandard } : {}),
        status: "review",
        evidence: evidence(LAUNCH_SOURCE_ID, fields, "Exact launch-grade identity and only directly stated powertrain, transmission and range facts are normalized from SGMW."),
        researchNotes: [
          "Sparse official launch grade: dimensions, displacement, power, battery capacity and charging values remain empty without a direct manufacturer specification table.",
          "The PHEV grade's 125 km figure has no cycle attached because the release does not state one; the BEV release explicitly labels 500 km as CLTC.",
        ],
        updatedAt: verifiedAt,
      };
    });

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
      exactLaunchGradesOnly: true,
      unstatedSpecificationsRejected: true,
      unknownPhevRangeStandardRejected: true,
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
  const { report, ingestion } = await buildWulingStarlight560Batch();
  await writeJson(REPORT_FILE, report);
  await writeJson(INGEST_FILE, ingestion);
  console.log(JSON.stringify(report.totals, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
