import path from "node:path";
import { pathToFileURL } from "node:url";
import { WORKSPACE_ROOT, loadWorkspace, writeJson } from "./lib.mjs";

const REPORT_FILE = path.join(WORKSPACE_ROOT, "reports/wuling-bingo-2024-specifications.json");
const INGEST_FILE = path.join(WORKSPACE_ROOT, "ingest/wuling-bingo-2024-specifications-2026-08-17.json");
const SOURCE_ID = "src-sgmw-wuling-bingo-2024-spec";
const MODEL_ID = "wuling/bingo";
const GENERATION_ID = "wuling/bingo/2024-model-year";

const DEFINITIONS = [
  { slug: "light-203-km", sourceName: "2024轻享款 203km", name: "Light 203 km", rangeKm: 203, motorPeakKw: 30, curbWeightKg: 1010, topSpeedKmh: 100 },
  { slug: "enjoy-333-km", sourceName: "2024悦享款 333km", name: "Enjoy 333 km", rangeKm: 333, motorPeakKw: 50, curbWeightKg: 1125, topSpeedKmh: 130 },
  { slug: "lingxi-connect-333-km", sourceName: "2024灵犀互联款 333km", name: "Lingxi Connect 333 km", rangeKm: 333, motorPeakKw: 50, curbWeightKg: 1140, topSpeedKmh: 130 },
  { slug: "lingxi-premium-410-km", sourceName: "2024灵犀尊享款 410km", name: "Lingxi Premium 410 km", rangeKm: 410, motorPeakKw: 50, curbWeightKg: 1185, topSpeedKmh: 130 },
];

function chunk(entityType, records) {
  return { schemaVersion: 2, entityType, chunk: 1, maxRecords: 250, records };
}

function evidence(fields, note) {
  return [{ sourceId: SOURCE_ID, fields, status: "verified", confidence: "official", note }];
}

export async function buildWulingBingo2024SpecBatch({ verifiedAt = "2026-08-17" } = {}) {
  const workspace = await loadWorkspace();
  const existingModel = workspace.records.model.find((record) => record.id === MODEL_ID);
  if (!existingModel) throw new Error(`${MODEL_ID} is missing`);
  const sourceIds = new Set(workspace.records.source.map((record) => record.id));
  const generationIds = new Set(workspace.records.generation.map((record) => record.id));
  const variantIds = new Set(workspace.records.variant.map((record) => record.id));

  const sources = sourceIds.has(SOURCE_ID) ? [] : [{
    id: SOURCE_ID,
    type: "manufacturer_technical_document",
    title: "五菱缤果2024款参数配置",
    publisher: "SAIC-GM-Wuling Automobile Co., Ltd. (SGMW)",
    url: "https://www.sgmw.com.cn/carDetail?id=4",
    documentId: "SGMW carDetail 4",
    documentDate: null,
    verifiedAt,
    market: "China",
    language: "zh-CN",
    supportedFields: [
      "productionFrom", "bodyTypes", "powertrainKinds", "name", "market", "yearFrom", "bodyType",
      "powertrainKind", "drive", "motorPeakKw", "rangeKm", "rangeStandard", "acChargeKw", "lengthMm",
      "widthMm", "heightMm", "wheelbaseMm", "curbWeightKg", "seats", "doors", "topSpeedKmh",
    ],
    confidence: "official",
    status: "active",
    license: null,
    notes: "Exact four-column 2024 model-year table. Battery capacity is not mapped because SGMW does not identify gross, usable or rated basis. Maximum motor power is stored as motorPeakKw, not legal 30-minute power.",
  }];

  const replacementModel = {
    ...existingModel,
    productionFrom: "2024",
    bodyTypes: ["Hatchback"],
    powertrainKinds: ["BEV"],
    evidence: [...existingModel.evidence, ...evidence(
      ["productionFrom", "bodyTypes", "powertrainKinds"],
      "Every official row is explicitly a 2024 battery-electric five-door, four-seat passenger car; Hatchback is the normalized public body classification.",
    )],
    researchNotes: [...existingModel.researchNotes, "Four exact 2024 China configurations are staged below; publication and pricing remain disconnected."],
    updatedAt: verifiedAt,
  };

  const generations = generationIds.has(GENERATION_ID) ? [] : [{
    id: GENERATION_ID,
    modelId: MODEL_ID,
    name: "2024 model year",
    aliases: [],
    platformCodes: [],
    productionFrom: "2024",
    productionTo: null,
    bodyTypes: ["Hatchback"],
    status: "review",
    evidence: evidence(["name", "productionFrom", "bodyTypes"], "All four rows are explicitly marked 2024 and share a five-door body."),
    researchNotes: ["Model-year container only; no platform or internal generation code is inferred."],
    updatedAt: verifiedAt,
  }];

  const variants = DEFINITIONS.filter((definition) => !variantIds.has(`${GENERATION_ID}/${definition.slug}`)).map((definition) => ({
    id: `${GENERATION_ID}/${definition.slug}`,
    modelId: MODEL_ID,
    generationId: GENERATION_ID,
    faceliftId: null,
    name: definition.name,
    aliases: [{ value: definition.sourceName, kind: "localized", safe: true, language: "zh-CN", market: "China", sourceIds: [SOURCE_ID] }],
    market: "China",
    yearFrom: 2024,
    yearTo: null,
    bodyType: "Hatchback",
    powertrainKind: "BEV",
    drive: "FWD",
    motorPeakKw: definition.motorPeakKw,
    rangeKm: definition.rangeKm,
    rangeStandard: "CLTC",
    acChargeKw: 3.3,
    lengthMm: 3950,
    widthMm: 1708,
    heightMm: 1580,
    wheelbaseMm: 2560,
    curbWeightKg: definition.curbWeightKg,
    seats: 4,
    doors: 5,
    topSpeedKmh: definition.topSpeedKmh,
    status: "review",
    evidence: evidence(
      ["name", "market", "yearFrom", "bodyType", "powertrainKind", "drive", "motorPeakKw", "rangeKm", "rangeStandard", "acChargeKw", "lengthMm", "widthMm", "heightMm", "wheelbaseMm", "curbWeightKg", "seats", "doors", "topSpeedKmh"],
      "Exact values transcribed column-for-column from SGMW's 2024 Bingo table. Front-engine/front-wheel drive is normalized to FWD; range is explicitly CLTC.",
    ),
    researchNotes: [
      "Battery capacity is intentionally not assigned to gross, usable or rated capacity without an explicit basis.",
      "No peak motor value is reused as legal 30-minute power. Pricing production remains disconnected.",
    ],
    updatedAt: verifiedAt,
  }));

  const report = {
    schemaVersion: 2,
    generatedAt: verifiedAt,
    productionConnected: false,
    totals: { newSources: sources.length, replacedModels: 1, newGenerations: generations.length, newVariants: variants.length },
    modelId: MODEL_ID,
    generationIds: generations.map((record) => record.id),
    variantIds: variants.map((record) => record.id),
    policy: {
      exactManufacturerColumnsOnly: true,
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
  const { report, ingestion } = await buildWulingBingo2024SpecBatch();
  await writeJson(REPORT_FILE, report);
  await writeJson(INGEST_FILE, ingestion);
  console.log(JSON.stringify(report.totals, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
