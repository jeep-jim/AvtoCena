import path from "node:path";
import { pathToFileURL } from "node:url";
import { WORKSPACE_ROOT, loadWorkspace, writeJson } from "./lib.mjs";

const REPORT_FILE = path.join(WORKSPACE_ROOT, "reports/wuling-starlight-730-specifications.json");
const INGEST_FILE = path.join(WORKSPACE_ROOT, "ingest/wuling-starlight-730-specifications-2026-08-17.json");
const MODEL_ID = "wuling/starlight-730";
const GENERATION_ID = `${MODEL_ID}/launch-lineup-2025`;
const SPEC_SOURCE_ID = "src-sgmw-wuling-starlight-730-spec";
const LAUNCH_SOURCE_ID = "src-sgmw-wuling-starlight-730-launch-2025";
const EXCLUSIVE_SOURCE_ID = "src-sgmw-wuling-starlight-730-exclusive-launch-2026";

const LAUNCH_VARIANTS = [
  {
    slug: "fuel-1-5t-6mt-comfort",
    sourceName: "燃油 1.5T 6MT 舒适型",
    name: "Fuel 1.5T 6MT Comfort",
    kind: "ICE",
    fuel: "Petrol",
    transmission: "6-speed manual",
    gears: 6,
    powerHp: 177,
    powerHpStandard: "PS",
    icePowerKw: 130,
    heightMm: 1760,
    curbWeightKg: 1560,
    grossWeightKg: 2140,
    tankCapacityL: 52,
    topSpeedKmh: 180,
  },
  {
    slug: "fuel-1-5t-cvt-elite",
    sourceName: "燃油 1.5T CVT 精英型",
    name: "Fuel 1.5T CVT Elite",
    kind: "ICE",
    fuel: "Petrol",
    transmission: "CVT",
    powerHp: 177,
    powerHpStandard: "PS",
    icePowerKw: 130,
    heightMm: 1770,
    curbWeightKg: 1610,
    grossWeightKg: 2200,
    tankCapacityL: 52,
    topSpeedKmh: 180,
  },
  {
    slug: "phev-125-km-luxury",
    sourceName: "插混 125km 豪华型",
    name: "PHEV 125 km Luxury",
    kind: "PHEV",
    fuel: "Petrol",
    transmission: "E-CVT",
    icePowerKw: 78,
    motorPeakKw: 145,
    rangeKm: 125,
    rangeStandard: "CLTC",
    acChargeKw: 3.3,
    heightMm: 1770,
    curbWeightKg: 1818,
    grossWeightKg: 2415,
    tankCapacityL: 52,
    topSpeedKmh: 170,
  },
  {
    slug: "bev-500-km-luxury",
    sourceName: "纯电 500km 豪华型",
    name: "BEV 500 km Luxury",
    kind: "BEV",
    transmission: "Fixed-ratio",
    motorPeakKw: 100,
    rangeKm: 500,
    rangeStandard: "CLTC",
    acChargeKw: 6.6,
    heightMm: 1770,
    curbWeightKg: 1810,
    grossWeightKg: 2405,
    topSpeedKmh: 160,
  },
];

const EXCLUSIVE_VARIANTS = [
  { slug: "fuel-1-5t-cvt-exclusive", sourceName: "燃油1.5T CVT尊享型", name: "Fuel 1.5T CVT Exclusive", kind: "ICE", fuel: "Petrol", transmission: "CVT" },
  { slug: "phev-125-km-exclusive", sourceName: "插混125 km尊享型", name: "PHEV 125 km Exclusive", kind: "PHEV", fuel: "Petrol", rangeKm: 125, rangeStandard: "CLTC" },
  { slug: "bev-500-km-exclusive", sourceName: "纯电500km尊享型", name: "BEV 500 km Exclusive", kind: "BEV", rangeKm: 500, rangeStandard: "CLTC" },
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

export async function buildWulingStarlight730Batch({ verifiedAt = "2026-08-17" } = {}) {
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
      title: "星光730参数配置",
      publisher: "SAIC-GM-Wuling Automobile Co., Ltd. (SGMW)",
      url: "https://www.sgmw.com.cn/carDetail?id=309",
      documentId: "SGMW carDetail 309",
      documentDate: null,
      verifiedAt,
      market: "China",
      language: "zh-CN",
      supportedFields: [
        "bodyTypes", "powertrainKinds", "name", "market", "bodyType", "powertrainKind", "fuel",
        "transmission", "gears", "drive", "powerHp", "powerHpStandard", "icePowerKw", "motorPeakKw",
        "rangeKm", "rangeStandard", "acChargeKw", "lengthMm", "widthMm", "heightMm", "wheelbaseMm",
        "curbWeightKg", "grossWeightKg", "tankCapacityL", "seats", "doors", "topSpeedKmh",
      ],
      confidence: "official",
      status: "active",
      license: null,
      notes: "Exact four-column manufacturer table for ICE, PHEV and BEV. Battery capacities are not mapped because gross, usable or rated basis is not stated. Maximum motor values are never reused as legal 30-minute power.",
    },
    {
      id: LAUNCH_SOURCE_ID,
      type: "manufacturer",
      title: "7.3万元起售！星光730正式上市，为万千家庭开启幸福之门",
      publisher: "SAIC-GM-Wuling Automobile Co., Ltd. (SGMW)",
      url: "https://lu.sgmw.com.cn/portal/details.html?id=53442",
      documentId: "SGMW portal 53442",
      documentDate: "2025-11-13",
      verifiedAt,
      market: "China",
      language: "zh-CN",
      supportedFields: ["productionFrom", "name", "yearFrom", "bodyTypes", "powertrainKinds"],
      confidence: "official",
      status: "active",
      license: null,
      notes: "Official release states a 2025-11-12 launch and names the four ICE, PHEV and BEV launch configurations.",
    },
    {
      id: EXCLUSIVE_SOURCE_ID,
      type: "manufacturer",
      title: "综合补贴价8.78万元起！星光730尊享型携7大核心升级正式上市",
      publisher: "SAIC-GM-Wuling Automobile Co., Ltd. (SGMW)",
      url: "https://lu.sgmw.com.cn/portal/details.html?id=56043",
      documentId: "SGMW portal 56043",
      documentDate: "2026-04-28",
      verifiedAt,
      market: "China",
      language: "zh-CN",
      supportedFields: ["name", "market", "yearFrom", "powertrainKind", "fuel", "transmission", "rangeKm", "rangeStandard"],
      confidence: "official",
      status: "active",
      license: null,
      notes: "Official release states that three Exclusive grades launched on 2026-04-27 and identifies their fuel, PHEV 125 km and BEV 500 km forms. Unstated technical values are left empty.",
    },
  ];
  const sources = sourceDefinitions.filter((source) => !sourceIds.has(source.id));

  const replacementModel = {
    ...existingModel,
    productionFrom: "2025-11",
    bodyTypes: ["MPV"],
    powertrainKinds: ["ICE", "PHEV", "BEV"],
    evidence: [
      ...existingModel.evidence,
      ...evidence(LAUNCH_SOURCE_ID, ["productionFrom", "bodyTypes", "powertrainKinds"], "SGMW dates the launch to 2025-11-12 and identifies a seven-seat MPV with ICE, PHEV and BEV forms."),
    ],
    researchNotes: [...existingModel.researchNotes, "Four launch configurations and three 2026 Exclusive grades are staged below; publication and pricing remain disconnected."],
    updatedAt: verifiedAt,
  };

  const generations = generationIds.has(GENERATION_ID) ? [] : [{
    id: GENERATION_ID,
    modelId: MODEL_ID,
    name: "Launch lineup (2025)",
    aliases: [],
    platformCodes: [],
    productionFrom: "2025-11",
    productionTo: null,
    bodyTypes: ["MPV"],
    status: "review",
    evidence: [
      ...evidence(LAUNCH_SOURCE_ID, ["name", "productionFrom"], "SGMW records the launch on 2025-11-12."),
      ...evidence(SPEC_SOURCE_ID, ["bodyTypes"], "Every manufacturer column explicitly identifies a five-door, seven-seat MPV."),
    ],
    researchNotes: ["Launch-lineup container only; no unverified platform or internal generation code is inferred."],
    updatedAt: verifiedAt,
  }];

  const launchVariants = LAUNCH_VARIANTS
    .filter((definition) => !variantIds.has(`${GENERATION_ID}/${definition.slug}`))
    .map((definition) => {
      const optional = {
        ...(definition.fuel ? { fuel: definition.fuel } : {}),
        ...(definition.transmission ? { transmission: definition.transmission } : {}),
        ...(definition.gears ? { gears: definition.gears } : {}),
        ...(definition.powerHp ? { powerHp: definition.powerHp, powerHpStandard: definition.powerHpStandard } : {}),
        ...(definition.icePowerKw ? { icePowerKw: definition.icePowerKw } : {}),
        ...(definition.motorPeakKw ? { motorPeakKw: definition.motorPeakKw } : {}),
        ...(definition.rangeKm ? { rangeKm: definition.rangeKm, rangeStandard: definition.rangeStandard } : {}),
        ...(definition.acChargeKw ? { acChargeKw: definition.acChargeKw } : {}),
        ...(definition.tankCapacityL ? { tankCapacityL: definition.tankCapacityL } : {}),
      };
      return {
        id: `${GENERATION_ID}/${definition.slug}`,
        modelId: MODEL_ID,
        generationId: GENERATION_ID,
        faceliftId: null,
        name: definition.name,
        aliases: [alias(definition.sourceName, SPEC_SOURCE_ID)],
        market: "China",
        yearFrom: 2025,
        yearTo: null,
        bodyType: "MPV",
        powertrainKind: definition.kind,
        ...optional,
        drive: "FWD",
        lengthMm: 4910,
        widthMm: 1850,
        heightMm: definition.heightMm,
        wheelbaseMm: 2910,
        curbWeightKg: definition.curbWeightKg,
        grossWeightKg: definition.grossWeightKg,
        seats: 7,
        doors: 5,
        topSpeedKmh: definition.topSpeedKmh,
        status: "review",
        evidence: [
          ...evidence(LAUNCH_SOURCE_ID, ["name", "yearFrom"], "Official launch record confirms the exact grade and 2025 launch year."),
          ...evidence(
            SPEC_SOURCE_ID,
            [
              "market", "bodyType", "powertrainKind", ...(definition.fuel ? ["fuel"] : []),
              ...(definition.transmission ? ["transmission"] : []), ...(definition.gears ? ["gears"] : []),
              ...(definition.powerHp ? ["powerHp", "powerHpStandard"] : []), ...(definition.icePowerKw ? ["icePowerKw"] : []),
              ...(definition.motorPeakKw ? ["motorPeakKw"] : []), ...(definition.rangeKm ? ["rangeKm", "rangeStandard"] : []),
              ...(definition.acChargeKw ? ["acChargeKw"] : []), "drive", "lengthMm", "widthMm", "heightMm", "wheelbaseMm",
              "curbWeightKg", "grossWeightKg", ...(definition.tankCapacityL ? ["tankCapacityL"] : []), "seats", "doors", "topSpeedKmh",
            ],
            "Exact values transcribed column-for-column from SGMW's four-column Starlight 730 table; front-engine/front-wheel drive is normalized to FWD.",
          ),
        ],
        researchNotes: [
          "Nominal 1.5 L displacement is not converted into an exact engineCc value without a precise manufacturer displacement.",
          "Battery capacity is intentionally not assigned to gross, usable or rated capacity without an explicit basis. Maximum motor power is never reused as legal 30-minute power.",
        ],
        updatedAt: verifiedAt,
      };
    });

  const exclusiveVariants = EXCLUSIVE_VARIANTS
    .filter((definition) => !variantIds.has(`${GENERATION_ID}/${definition.slug}`))
    .map((definition) => ({
      id: `${GENERATION_ID}/${definition.slug}`,
      modelId: MODEL_ID,
      generationId: GENERATION_ID,
      faceliftId: null,
      name: definition.name,
      aliases: [alias(definition.sourceName, EXCLUSIVE_SOURCE_ID)],
      market: "China",
      yearFrom: 2026,
      yearTo: null,
      bodyType: "MPV",
      powertrainKind: definition.kind,
      ...(definition.fuel ? { fuel: definition.fuel } : {}),
      ...(definition.transmission ? { transmission: definition.transmission } : {}),
      ...(definition.rangeKm ? { rangeKm: definition.rangeKm, rangeStandard: definition.rangeStandard } : {}),
      status: "review",
      evidence: [
        ...evidence(SPEC_SOURCE_ID, ["bodyType"], "The model-specific manufacturer table identifies Starlight 730 as an MPV."),
        ...evidence(
          EXCLUSIVE_SOURCE_ID,
          ["name", "market", "yearFrom", "powertrainKind", ...(definition.fuel ? ["fuel"] : []), ...(definition.transmission ? ["transmission"] : []), ...(definition.rangeKm ? ["rangeKm", "rangeStandard"] : [])],
          "Official 2026 release confirms the exact Exclusive grade and only the stated powertrain/range fields; unstated specifications remain empty.",
        ),
      ],
      researchNotes: ["Sparse official grade identity: no launch-lineup technical value is copied into this 2026 grade without a direct source."],
      updatedAt: verifiedAt,
    }));

  const variants = [...launchVariants, ...exclusiveVariants];
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
      sparse2026GradesNotBackfilled: true,
      nominalDisplacementNotConverted: true,
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
  const { report, ingestion } = await buildWulingStarlight730Batch();
  await writeJson(REPORT_FILE, report);
  await writeJson(INGEST_FILE, ingestion);
  console.log(JSON.stringify(report.totals, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
