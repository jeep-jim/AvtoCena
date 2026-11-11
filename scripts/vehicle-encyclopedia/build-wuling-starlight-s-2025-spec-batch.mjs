import path from "node:path";
import { pathToFileURL } from "node:url";
import { WORKSPACE_ROOT, loadWorkspace, writeJson } from "./lib.mjs";

const REPORT_FILE = path.join(WORKSPACE_ROOT, "reports/wuling-starlight-s-2025-specifications.json");
const INGEST_FILE = path.join(WORKSPACE_ROOT, "ingest/wuling-starlight-s-2025-specifications-2026-08-17.json");
const SOURCE_ID = "src-sgmw-wuling-starlight-s-2025-spec";
const MODEL_ID = "wuling/starlight-s";
const GENERATION_ID = "wuling/starlight-s/2025-model-year";

const DEFINITIONS = [
  { slug: "60-km-advanced", sourceName: "60km 进阶型", name: "60 km Advanced", kind: "PHEV", rangeKm: 60, icePowerKw: 78, motorPeakKw: 150, heightMm: 1685, curbWeightKg: 1680, grossWeightKg: 2090, tankCapacityL: 53, acChargeKw: 3.3, topSpeedKmh: 170 },
  { slug: "130-km-leading", sourceName: "130km 领航型", name: "130 km Leading", kind: "PHEV", rangeKm: 130, icePowerKw: 78, motorPeakKw: 150, heightMm: 1680, curbWeightKg: 1745, grossWeightKg: 2200, tankCapacityL: 53, acChargeKw: 3.3, topSpeedKmh: 170 },
  { slug: "130-km-flagship", sourceName: "130km 旗舰型", name: "130 km Flagship", kind: "PHEV", rangeKm: 130, icePowerKw: 78, motorPeakKw: 150, heightMm: 1680, curbWeightKg: 1790, grossWeightKg: 2200, tankCapacityL: 53, acChargeKw: 3.3, topSpeedKmh: 170 },
  { slug: "130-km-high-power-flagship", sourceName: "130km 高功率旗舰型", name: "130 km High-Power Flagship", kind: "PHEV", rangeKm: 130, icePowerKw: 105, motorPeakKw: 160, heightMm: 1680, curbWeightKg: 1825, grossWeightKg: 2240, tankCapacityL: 53, acChargeKw: 3.3, topSpeedKmh: 185 },
  { slug: "510-km-leading", sourceName: "510km 领航型", name: "510 km Leading", kind: "BEV", rangeKm: 510, motorPeakKw: 150, heightMm: 1680, curbWeightKg: 1735, grossWeightKg: 2190, acChargeKw: 6.6, topSpeedKmh: 175 },
  { slug: "510-km-flagship", sourceName: "510km 旗舰型", name: "510 km Flagship", kind: "BEV", rangeKm: 510, motorPeakKw: 150, heightMm: 1680, curbWeightKg: 1780, grossWeightKg: 2190, acChargeKw: 6.6, topSpeedKmh: 175 },
];

function chunk(entityType, records) {
  return { schemaVersion: 2, entityType, chunk: 1, maxRecords: 250, records };
}

function evidence(fields, note) {
  return [{ sourceId: SOURCE_ID, fields, status: "verified", confidence: "official", note }];
}

export async function buildWulingStarlightS2025SpecBatch({ verifiedAt = "2026-08-17" } = {}) {
  const workspace = await loadWorkspace();
  const existingSourceIds = new Set(workspace.records.source.map((record) => record.id));
  const existingGenerationIds = new Set(workspace.records.generation.map((record) => record.id));
  const existingVariantIds = new Set(workspace.records.variant.map((record) => record.id));
  const existingModel = workspace.records.model.find((record) => record.id === MODEL_ID);
  if (!existingModel) throw new Error(`${MODEL_ID} is missing`);

  const sources = existingSourceIds.has(SOURCE_ID) ? [] : [{
    id: SOURCE_ID,
    type: "manufacturer_technical_document",
    title: "五菱星光S 2025款参数配置",
    publisher: "SAIC-GM-Wuling Automobile Co., Ltd. (SGMW)",
    url: "https://www.sgmw.com.cn/carDetail?id=304",
    documentId: "SGMW carDetail 304",
    documentDate: null,
    verifiedAt,
    market: "China",
    language: "zh-CN",
    supportedFields: [
      "canonicalName", "productionFrom", "bodyTypes", "powertrainKinds", "name", "market", "yearFrom",
      "bodyType", "powertrainKind", "transmission", "drive", "icePowerKw", "motorPeakKw", "rangeKm",
      "rangeStandard", "acChargeKw", "lengthMm", "widthMm", "heightMm", "wheelbaseMm", "curbWeightKg",
      "grossWeightKg", "tankCapacityL", "seats", "doors", "topSpeedKmh",
    ],
    confidence: "official",
    status: "active",
    license: null,
    notes: "Exact six-column 2025 model-year manufacturer table. Battery capacities are not mapped because the table does not distinguish gross, usable or rated basis. Motor maximum power is mapped to motorPeakKw, never to 30-minute power.",
  }];

  const replacementModel = {
    ...existingModel,
    productionFrom: "2025",
    bodyTypes: ["SUV"],
    powertrainKinds: ["PHEV", "BEV"],
    evidence: [
      ...existingModel.evidence,
      ...evidence(
        ["productionFrom", "bodyTypes", "powertrainKinds"],
        "SGMW explicitly labels the table as 2025 model year and identifies every row as a five-door, five-seat SUV with PHEV or BEV powertrain.",
      ),
    ],
    researchNotes: [...existingModel.researchNotes, "Six exact 2025 China configurations are staged below; publication and pricing remain disconnected."],
    updatedAt: verifiedAt,
  };

  const generations = existingGenerationIds.has(GENERATION_ID) ? [] : [{
    id: GENERATION_ID,
    modelId: MODEL_ID,
    name: "2025 model year",
    aliases: [],
    platformCodes: [],
    productionFrom: "2025",
    productionTo: null,
    bodyTypes: ["SUV"],
    status: "review",
    evidence: evidence(
      ["name", "productionFrom", "bodyTypes"],
      "The official model-specific specification is explicitly titled 2025 model year and lists a five-door SUV body for all configurations.",
    ),
    researchNotes: ["Model-year container only; no unverified platform or internal generation code is assigned."],
    updatedAt: verifiedAt,
  }];

  const variants = DEFINITIONS.filter((definition) => !existingVariantIds.has(`${GENERATION_ID}/${definition.slug}`)).map((definition) => {
    const isPhev = definition.kind === "PHEV";
    const fields = [
      "name", "market", "yearFrom", "bodyType", "powertrainKind", "drive", "motorPeakKw", "rangeKm",
      "rangeStandard", "acChargeKw", "lengthMm", "widthMm", "heightMm", "wheelbaseMm", "curbWeightKg",
      "grossWeightKg", "seats", "doors", "topSpeedKmh",
      ...(isPhev ? ["transmission", "icePowerKw", "tankCapacityL"] : []),
    ];
    return {
      id: `${GENERATION_ID}/${definition.slug}`,
      modelId: MODEL_ID,
      generationId: GENERATION_ID,
      faceliftId: null,
      name: definition.name,
      aliases: [{ value: definition.sourceName, kind: "localized", safe: true, language: "zh-CN", market: "China", sourceIds: [SOURCE_ID] }],
      market: "China",
      yearFrom: 2025,
      yearTo: null,
      bodyType: "SUV",
      powertrainKind: definition.kind,
      ...(isPhev ? { transmission: "E-CVT", icePowerKw: definition.icePowerKw, tankCapacityL: definition.tankCapacityL } : {}),
      drive: "FWD",
      motorPeakKw: definition.motorPeakKw,
      rangeKm: definition.rangeKm,
      rangeStandard: "CLTC",
      acChargeKw: definition.acChargeKw,
      lengthMm: 4745,
      widthMm: 1890,
      heightMm: definition.heightMm,
      wheelbaseMm: 2800,
      curbWeightKg: definition.curbWeightKg,
      grossWeightKg: definition.grossWeightKg,
      seats: 5,
      doors: 5,
      topSpeedKmh: definition.topSpeedKmh,
      status: "review",
      evidence: evidence(fields, "Exact values transcribed column-for-column from SGMW's 2025 Starlight S specification. FWD normalizes front-engine/front-wheel drive; range is explicitly CLTC."),
      researchNotes: [
        "Battery value remains in the source but is not assigned to gross, usable or rated capacity without an explicit manufacturer basis.",
        "No peak motor value is reused as legal 30-minute power. Pricing production remains disconnected.",
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
    generationIds: generations.map((generation) => generation.id),
    variantIds: variants.map((variant) => variant.id),
    policy: {
      exactManufacturerColumnsOnly: true,
      batteryBasisUnspecifiedAndRejected: true,
      motorPeakNotPower30Min: true,
      modelYearNotPlatformGeneration: true,
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
  const { report, ingestion } = await buildWulingStarlightS2025SpecBatch();
  await writeJson(REPORT_FILE, report);
  await writeJson(INGEST_FILE, ingestion);
  console.log(JSON.stringify(report.totals, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
