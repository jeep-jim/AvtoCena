import path from "node:path";
import { pathToFileURL } from "node:url";
import { WORKSPACE_ROOT, loadWorkspace, writeJson } from "./lib.mjs";

const REPORT_FILE = path.join(WORKSPACE_ROOT, "reports/wuling-xing-chi-2022-specifications.json");
const INGEST_FILE = path.join(WORKSPACE_ROOT, "ingest/wuling-xing-chi-2022-specifications-2026-08-18.json");
const MODEL_ID = "wuling/xingchi";
const GENERATION_ID = `${MODEL_ID}/launch-2022`;
const EN_LAUNCH_SOURCE_ID = "src-gm-wuling-xing-chi-launch-en-2022";
const SPEC_SOURCE_ID = "src-sgmw-wuling-xingchi-current-spec";

const VARIANTS = [
  { slug: "1-5l-6mt-freedom", sourceName: "1.5L 6MT 自由型", name: "1.5L 6MT Freedom", transmission: "6-speed manual", gears: 6, curbWeightKg: 1190 },
  { slug: "1-5l-cvt-play", sourceName: "1.5L CVT 畅玩型", name: "1.5L CVT Play", transmission: "CVT", curbWeightKg: 1240 },
];

function chunk(entityType, records) {
  return { schemaVersion: 2, entityType, chunk: 1, maxRecords: 250, records };
}

function evidence(sourceId, fields, note) {
  return [{ sourceId, fields, status: "verified", confidence: "official", note }];
}

function alias(value, sourceId = SPEC_SOURCE_ID) {
  return { value, kind: "localized", safe: true, language: "zh-CN", market: "China", sourceIds: [sourceId] };
}

export async function buildWulingXingChi2022Batch({ verifiedAt = "2026-08-18" } = {}) {
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
      title: "Wuling Introduces All-New Xing Chi Small SUV",
      publisher: "General Motors / SAIC-GM-Wuling",
      url: "https://news.gm.com.cn/en/home.detail.html/Pages/news/cn/en/2022/Sept/0929-wuling.html",
      documentId: "GM China Wuling Xing Chi 2022-09-29 EN",
      documentDate: "2022-09-29",
      verifiedAt,
      market: "China",
      language: "en",
      supportedFields: ["canonicalName", "productionFrom", "bodyTypes", "powertrainKinds", "name", "market", "yearFrom", "bodyType", "powertrainKind", "fuel", "transmission"],
      confidence: "official",
      status: "active",
      license: null,
      notes: "Official English launch establishes the spaced public name Xing Chi, September 2022 China launch, small-SUV body and six-variant ICE range with 1.5-liter manual/CVT and 1.5-liter turbo CVT powertrains.",
    },
    {
      id: SPEC_SOURCE_ID,
      type: "manufacturer_technical_document",
      title: "五菱星驰参数配置",
      publisher: "SAIC-GM-Wuling Automobile Co., Ltd. (SGMW)",
      url: "https://www.sgmw.com.cn/carDetail?id=22",
      documentId: "SGMW carDetail 22",
      documentDate: null,
      verifiedAt,
      market: "China",
      language: "zh-CN",
      supportedFields: [
        "name", "market", "bodyType", "powertrainKind", "fuel", "engineCc", "transmission", "gears",
        "drive", "icePowerKw", "lengthMm", "widthMm", "heightMm", "wheelbaseMm", "curbWeightKg", "tankCapacityL",
      ],
      confidence: "official",
      status: "active",
      license: null,
      notes: "Current official two-column table supplies exact grade names and technical values. 1.485 L is normalized to the exact equivalent 1,485 cm³; simulated CVT steps are not stored as physical gears and kW is not converted to horsepower.",
    },
  ];
  const sources = sourceDefinitions.filter((source) => !sourceIds.has(source.id));

  const aliases = [...existingModel.aliases];
  if (!aliases.some((record) => record.value === "Xingchi")) {
    aliases.push({
      value: "Xingchi",
      kind: "transliteration",
      safe: true,
      language: "zh-Latn",
      market: "China",
      sourceIds: ["src-sgmw-wuling-silver-current-zh-2026"],
    });
  }

  const replacementModel = {
    ...existingModel,
    canonicalName: "Xing Chi",
    aliases,
    productionFrom: "2022-09",
    bodyTypes: ["SUV"],
    powertrainKinds: ["ICE"],
    evidence: [
      ...existingModel.evidence,
      ...evidence(EN_LAUNCH_SOURCE_ID, ["canonicalName", "productionFrom", "bodyTypes", "powertrainKinds"], "Official English release uses the public name Xing Chi and identifies the September 2022 ICE small-SUV launch."),
    ],
    researchNotes: [
      ...existingModel.researchNotes,
      "Canonical public name corrected from the review-only joined romanization Xingchi to official English Xing Chi; Xingchi remains a searchable transliteration alias.",
      "Two exact official 1.5L configurations are staged below; the four remaining 2022 launch configurations stay queued until manufacturer columns are recovered.",
    ],
    updatedAt: verifiedAt,
  };

  const generations = generationIds.has(GENERATION_ID) ? [] : [{
    id: GENERATION_ID,
    modelId: MODEL_ID,
    name: "Launch generation (2022)",
    aliases: [alias("五菱星驰", "src-sgmw-wuling-silver-current-zh-2026")],
    platformCodes: [],
    productionFrom: "2022-09",
    productionTo: null,
    bodyTypes: ["SUV"],
    status: "review",
    evidence: evidence(EN_LAUNCH_SOURCE_ID, ["name", "productionFrom", "bodyTypes"], "Official release dates the all-new small-SUV launch to 2022-09-28."),
    researchNotes: ["Launch-generation container only; no unverified platform or internal generation code is inferred."],
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
      powertrainKind: "ICE",
      fuel: "Petrol",
      engineCc: 1485,
      transmission: definition.transmission,
      ...(definition.gears ? { gears: definition.gears } : {}),
      drive: "FWD",
      icePowerKw: 73,
      lengthMm: 4350,
      widthMm: 1750,
      heightMm: 1610,
      wheelbaseMm: 2550,
      curbWeightKg: definition.curbWeightKg,
      tankCapacityL: 45,
      status: "review",
      evidence: [
        ...evidence(EN_LAUNCH_SOURCE_ID, ["market", "yearFrom", "bodyType", "powertrainKind", "fuel", "transmission"], "Official launch establishes the 2022 China small-SUV range and its 1.5-liter manual/CVT powertrain choices."),
        ...evidence(SPEC_SOURCE_ID, ["name", "market", "bodyType", "powertrainKind", "fuel", "engineCc", "transmission", ...(definition.gears ? ["gears"] : []), "drive", "icePowerKw", "lengthMm", "widthMm", "heightMm", "wheelbaseMm", "curbWeightKg", "tankCapacityL"], "Exact values are transcribed column-for-column from the current SGMW table; front-engine/front-wheel drive is normalized to FWD."),
      ],
      researchNotes: [
        "The English grade label is a conservative translation of the exact Chinese alias; matching and audit retain the manufacturer wording.",
        "No horsepower is calculated from the official kW value. Simulated CVT steps are not stored as physical gears.",
      ],
      updatedAt: verifiedAt,
    }));

  const report = {
    schemaVersion: 2,
    generatedAt: verifiedAt,
    productionConnected: false,
    totals: { newSources: sources.length, replacedModels: 1, newGenerations: generations.length, newVariants: variants.length },
    modelId: MODEL_ID,
    canonicalName: "Xing Chi",
    generationIds: [GENERATION_ID],
    variantIds: variants.map((record) => record.id),
    policy: {
      officialEnglishCanonicalName: true,
      localizedSourceNamesRetainedAsAliases: true,
      exactManufacturerValuesOnly: true,
      simulatedCvtStepsNotStoredAsGears: true,
      horsepowerNotCalculated: true,
      remainingLaunchGradesQueued: 4,
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
  const { report, ingestion } = await buildWulingXingChi2022Batch();
  await writeJson(REPORT_FILE, report);
  await writeJson(INGEST_FILE, ingestion);
  console.log(JSON.stringify(report.totals, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
