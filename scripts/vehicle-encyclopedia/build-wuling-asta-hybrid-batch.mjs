import path from "node:path";
import { pathToFileURL } from "node:url";
import { WORKSPACE_ROOT, loadWorkspace, writeJson } from "./lib.mjs";

const REPORT_FILE = path.join(WORKSPACE_ROOT, "reports/wuling-asta-hybrid-specifications.json");
const INGEST_FILE = path.join(WORKSPACE_ROOT, "ingest/wuling-asta-hybrid-specifications-2026-08-17.json");
const MODEL_ID = "wuling/xingchen";
const GENERATION_ID = `${MODEL_ID}/hybrid-2022`;
const LAUNCH_SOURCE_ID = "src-gm-wuling-asta-hybrid-launch-en-2022";
const SPEC_SOURCE_ID = "src-sgmw-wuling-xingchen-hybrid-spec";
const CURRENT_CHINESE_SOURCE_ID = "src-sgmw-wuling-silver-current-zh-2026";

const VARIANTS = [
  { slug: "2-0l-dht-power", sourceName: "2.0L DHT 电劲款", name: "2.0L DHT Power", curbWeightKg: 1595 },
  { slug: "2-0l-dht-speed", sourceName: "2.0L DHT 电速款", name: "2.0L DHT Speed", curbWeightKg: 1615 },
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

export async function buildWulingAstaHybridBatch({ verifiedAt = "2026-08-17" } = {}) {
  const workspace = await loadWorkspace();
  const existingModel = workspace.records.model.find((record) => record.id === MODEL_ID);
  if (!existingModel) throw new Error(`${MODEL_ID} is missing`);
  const sourceIds = new Set(workspace.records.source.map((record) => record.id));
  const generationIds = new Set(workspace.records.generation.map((record) => record.id));
  const variantIds = new Set(workspace.records.variant.map((record) => record.id));

  const sourceDefinitions = [
    {
      id: LAUNCH_SOURCE_ID,
      type: "manufacturer",
      title: "SAIC-GM-Wuling Expands Electric Vehicle Lineup with Wuling Asta Hybrid",
      publisher: "General Motors / SAIC-GM-Wuling",
      url: "https://news.gm.com.cn/en/home.detail.html/Pages/news/cn/en/2022/Aug/0825-wuling.html",
      documentId: "GM China Wuling 2022-08-25 EN",
      documentDate: "2022-08-25",
      verifiedAt,
      market: "China",
      language: "en",
      supportedFields: ["canonicalName", "productionFrom", "bodyTypes", "powertrainKinds", "name", "yearFrom", "bodyType", "powertrainKind", "transmission"],
      confidence: "official",
      status: "active",
      license: null,
      notes: "Official English release establishes Asta as the public English model name, says the original SUV went on sale in September 2021, and records the two-variant HEV DHT launch on 2022-08-25.",
    },
    {
      id: SPEC_SOURCE_ID,
      type: "manufacturer_technical_document",
      title: "五菱星辰混动版参数配置",
      publisher: "SAIC-GM-Wuling Automobile Co., Ltd. (SGMW)",
      url: "https://www.sgmw.com.cn/carDetail?id=41",
      documentId: "SGMW carDetail 41",
      documentDate: null,
      verifiedAt,
      market: "China",
      language: "zh-CN",
      supportedFields: [
        "name", "market", "bodyType", "powertrainKind", "fuel", "engineCc", "transmission",
        "drive", "icePowerKw", "lengthMm", "widthMm", "heightMm", "wheelbaseMm",
        "curbWeightKg", "tankCapacityL", "seats",
      ],
      confidence: "official",
      status: "active",
      license: null,
      notes: "Exact two-column manufacturer table for the Asta/Xingchen HEV. The table labels 130 kW as motor rated power, so it is not mapped to motorPeakKw or legal 30-minute power.",
    },
  ];
  const sources = sourceDefinitions.filter((source) => !sourceIds.has(source.id));

  const replacementModel = {
    ...existingModel,
    canonicalName: "Asta",
    slug: "asta",
    aliases: [
      ...existingModel.aliases.filter((item) => item.value !== "Xingchen"),
      { value: "Xingchen", kind: "transliteration", safe: true, language: "zh-Latn", market: "China", sourceIds: [CURRENT_CHINESE_SOURCE_ID] },
    ],
    productionFrom: "2021-09",
    bodyTypes: ["SUV"],
    powertrainKinds: [...new Set([...existingModel.powertrainKinds, "HEV"])],
    evidence: [
      ...existingModel.evidence,
      ...evidence(LAUNCH_SOURCE_ID, ["canonicalName", "productionFrom", "bodyTypes", "powertrainKinds"], "Official English release uses Wuling Asta and identifies the September 2021 SUV plus its 2022 HEV expansion."),
    ],
    researchNotes: [
      ...existingModel.researchNotes,
      "Canonical public name corrected from review-only Xingchen romanization to official English Asta; Xingchen remains a searchable transliteration alias.",
      "The exact two-grade 2022 HEV lineup is staged below; existing ICE identity remains part of the same model family.",
    ],
    updatedAt: verifiedAt,
  };

  const generations = generationIds.has(GENERATION_ID) ? [] : [{
    id: GENERATION_ID,
    modelId: MODEL_ID,
    name: "Hybrid (2022)",
    aliases: [],
    platformCodes: [],
    productionFrom: "2022-08",
    productionTo: null,
    bodyTypes: ["SUV"],
    status: "review",
    evidence: evidence(LAUNCH_SOURCE_ID, ["name", "productionFrom", "bodyTypes"], "Official release records the Asta HEV launch on 2022-08-25."),
    researchNotes: ["Powertrain-edition container only; no unverified platform or internal generation code is inferred."],
    updatedAt: verifiedAt,
  }];

  const variants = VARIANTS
    .filter((definition) => !variantIds.has(`${GENERATION_ID}/${definition.slug}`))
    .map((definition) => ({
      id: `${GENERATION_ID}/${definition.slug}`,
      modelId: MODEL_ID,
      generationId: GENERATION_ID,
      faceliftId: null,
      name: definition.name,
      aliases: [alias(definition.sourceName)],
      market: "China",
      yearFrom: 2022,
      yearTo: null,
      bodyType: "SUV",
      powertrainKind: "HEV",
      fuel: "Petrol",
      engineCc: 1999,
      transmission: "DHT",
      drive: "FWD",
      icePowerKw: 100,
      lengthMm: 4594,
      widthMm: 1820,
      heightMm: 1740,
      wheelbaseMm: 2750,
      curbWeightKg: definition.curbWeightKg,
      tankCapacityL: 52,
      seats: 5,
      status: "review",
      evidence: [
        ...evidence(LAUNCH_SOURCE_ID, ["yearFrom"], "Official release dates the two-variant HEV launch to 2022-08-25."),
        ...evidence(
          SPEC_SOURCE_ID,
          ["name", "market", "bodyType", "powertrainKind", "fuel", "engineCc", "transmission", "drive", "icePowerKw", "lengthMm", "widthMm", "heightMm", "wheelbaseMm", "curbWeightKg", "tankCapacityL", "seats"],
          "Exact values transcribed column-for-column from SGMW; 1.999 L is normalized to the exact equivalent 1,999 cm³ and front-engine/front-wheel drive to FWD.",
        ),
      ],
      researchNotes: [
        "The manufacturer's 130 kW motor value is explicitly rated power, so it is not reused as motorPeakKw, powerKw or legal 30-minute power.",
        "No horsepower value is calculated from kW.",
      ],
      updatedAt: verifiedAt,
    }));

  const report = {
    schemaVersion: 2,
    generatedAt: verifiedAt,
    productionConnected: false,
    totals: { newSources: sources.length, replacedModels: 1, newGenerations: generations.length, newVariants: variants.length },
    modelId: MODEL_ID,
    canonicalName: "Asta",
    retainedAliases: ["Xingchen", "五菱 星辰"],
    generationIds: [GENERATION_ID],
    variantIds: variants.map((record) => record.id),
    policy: {
      officialEnglishCanonicalName: true,
      exactManufacturerValuesOnly: true,
      exactUnitConversionOnly: true,
      motorRatedPowerNotPeakOrPower30Min: true,
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
  const { report, ingestion } = await buildWulingAstaHybridBatch();
  await writeJson(REPORT_FILE, report);
  await writeJson(INGEST_FILE, ingestion);
  console.log(JSON.stringify(report.totals, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
