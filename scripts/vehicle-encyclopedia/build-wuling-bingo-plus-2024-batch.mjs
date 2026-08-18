import path from "node:path";
import { pathToFileURL } from "node:url";
import { WORKSPACE_ROOT, loadWorkspace, writeJson } from "./lib.mjs";

const REPORT_FILE = path.join(WORKSPACE_ROOT, "reports/wuling-bingo-plus-2024-specifications.json");
const INGEST_FILE = path.join(WORKSPACE_ROOT, "ingest/wuling-bingo-plus-2024-specifications-2026-08-17.json");
const MODEL_ID = "wuling/bingo-plus";
const GENERATION_ID = `${MODEL_ID}/five-seat-2024`;
const SPEC_SOURCE_ID = "src-sgmw-wuling-bingo-plus-five-seat-spec";
const LAUNCH_SOURCE_ID = "src-sgmw-wuling-bingo-suv-five-seat-launch-2024";

const DEFINITIONS = [
  { slug: "330-km-five-seat", sourceName: "330km五座版", name: "330 km Five-seat", rangeKm: 330, curbWeightKg: 1190, acChargeKw: 3.3 },
  { slug: "401-km-five-seat", sourceName: "401km五座版", name: "401 km Five-seat", rangeKm: 401, curbWeightKg: 1235, acChargeKw: 3.3 },
  { slug: "510-km-five-seat", sourceName: "510km五座版", name: "510 km Five-seat", rangeKm: 510, curbWeightKg: 1335, acChargeKw: 6.6 },
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

export async function buildWulingBingoPlus2024Batch({ verifiedAt = "2026-08-17" } = {}) {
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
      title: "五菱缤果PLUS五座版参数配置",
      publisher: "SAIC-GM-Wuling Automobile Co., Ltd. (SGMW)",
      url: "https://www.sgmw.com.cn/carDetail?id=257",
      documentId: "SGMW carDetail 257",
      documentDate: null,
      verifiedAt,
      market: "China",
      language: "zh-CN",
      supportedFields: [
        "bodyTypes", "powertrainKinds", "name", "market", "bodyType", "powertrainKind", "motorPeakKw",
        "rangeKm", "rangeStandard", "acChargeKw", "lengthMm", "widthMm", "heightMm", "wheelbaseMm",
        "curbWeightKg", "seats", "doors", "topSpeedKmh",
      ],
      confidence: "official",
      status: "active",
      license: null,
      notes: "Exact three-column five-seat table. SGMW explicitly identifies a five-door hatchback. Battery capacity is not mapped because gross, usable or rated basis is not stated; maximum motor power is never reused as legal 30-minute power.",
    },
    {
      id: LAUNCH_SOURCE_ID,
      type: "manufacturer",
      title: "售价7.58万元起！五菱缤果SUV五座版缤纷上市",
      publisher: "SAIC-GM-Wuling Automobile Co., Ltd. (SGMW)",
      url: "https://lu.sgmw.com.cn/portal/details.html?id=47796",
      documentId: "SGMW portal 47796",
      documentDate: "2024-09-21",
      verifiedAt,
      market: "China",
      language: "zh-CN",
      supportedFields: ["productionFrom", "name", "yearFrom"],
      confidence: "official",
      status: "active",
      license: null,
      notes: "Official release states that the five-seat model launched on 2024-09-20 with 330 km, 401 km and 510 km configurations.",
    },
  ];
  const sources = sourceDefinitions.filter((source) => !sourceIds.has(source.id));

  const replacementModel = {
    ...existingModel,
    productionFrom: "2024-09",
    bodyTypes: ["Hatchback"],
    powertrainKinds: ["BEV"],
    evidence: [
      ...existingModel.evidence,
      ...evidence(LAUNCH_SOURCE_ID, ["productionFrom"], "SGMW dates the five-seat launch to 2024-09-20."),
      ...evidence(SPEC_SOURCE_ID, ["bodyTypes", "powertrainKinds"], "Every official row is a battery-electric five-door hatchback."),
    ],
    researchNotes: [...existingModel.researchNotes, "Three exact 2024 five-seat configurations are staged below; publication and pricing remain disconnected."],
    updatedAt: verifiedAt,
  };

  const generations = generationIds.has(GENERATION_ID) ? [] : [{
    id: GENERATION_ID,
    modelId: MODEL_ID,
    name: "Five-seat (2024)",
    aliases: [alias("SUV五座版", LAUNCH_SOURCE_ID), alias("五座版", SPEC_SOURCE_ID)],
    platformCodes: [],
    productionFrom: "2024-09",
    productionTo: null,
    bodyTypes: ["Hatchback"],
    status: "review",
    evidence: [
      ...evidence(LAUNCH_SOURCE_ID, ["name", "productionFrom"], "SGMW launched the named five-seat edition on 2024-09-20."),
      ...evidence(SPEC_SOURCE_ID, ["bodyTypes"], "The manufacturer table explicitly identifies a five-door hatchback."),
    ],
    researchNotes: ["Edition container only; no unverified platform or internal generation code is inferred."],
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
      yearFrom: 2024,
      yearTo: null,
      bodyType: "Hatchback",
      powertrainKind: "BEV",
      motorPeakKw: 75,
      rangeKm: definition.rangeKm,
      rangeStandard: "CLTC",
      acChargeKw: definition.acChargeKw,
      lengthMm: 4090,
      widthMm: 1720,
      heightMm: 1575,
      wheelbaseMm: 2610,
      curbWeightKg: definition.curbWeightKg,
      seats: 5,
      doors: 5,
      topSpeedKmh: 140,
      status: "review",
      evidence: [
        ...evidence(LAUNCH_SOURCE_ID, ["yearFrom"], "Official release confirms the 2024 launch year."),
        ...evidence(
          SPEC_SOURCE_ID,
          ["name", "market", "bodyType", "powertrainKind", "motorPeakKw", "rangeKm", "rangeStandard", "acChargeKw", "lengthMm", "widthMm", "heightMm", "wheelbaseMm", "curbWeightKg", "seats", "doors", "topSpeedKmh"],
          "Exact values transcribed column-for-column from SGMW's three-column five-seat table; range is explicitly CLTC.",
        ),
      ],
      researchNotes: [
        "Battery capacity is intentionally not assigned to gross, usable or rated capacity without an explicit basis.",
        "No drivetrain layout is inferred. Maximum motor power is stored only as motorPeakKw, never as legal 30-minute power.",
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
      drivetrainNotInferred: true,
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
  const { report, ingestion } = await buildWulingBingoPlus2024Batch();
  await writeJson(REPORT_FILE, report);
  await writeJson(INGEST_FILE, ingestion);
  console.log(JSON.stringify(report.totals, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
