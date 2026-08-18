import path from "node:path";
import { pathToFileURL } from "node:url";
import { WORKSPACE_ROOT, loadWorkspace, writeJson } from "./lib.mjs";

const REPORT_FILE = path.join(WORKSPACE_ROOT, "reports/wuling-victory-280t-specifications.json");
const INGEST_FILE = path.join(WORKSPACE_ROOT, "ingest/wuling-victory-280t-specifications-2026-08-17.json");
const MODEL_ID = "wuling/kaijie";
const GENERATION_ID = `${MODEL_ID}/280t-2022`;
const EN_SOURCE_ID = "src-gm-wuling-victory-280t-launch-en-2022";
const ZH_SOURCE_ID = "src-gm-wuling-kaijie-280t-launch-zh-2022";
const SPEC_SOURCE_ID = "src-sgmw-wuling-kaijie-spec";
const CURRENT_CHINESE_SOURCE_ID = "src-sgmw-wuling-silver-current-zh-2026";

const VARIANTS = [
  { slug: "1-5t-cvt-280t-premium", sourceName: "1.5T CVT自动尊贵型 280T", name: "1.5T CVT 280T Premium" },
  { slug: "1-5t-cvt-280t-flagship", sourceName: "1.5T CVT自动旗舰型 280T", name: "1.5T CVT 280T Flagship" },
];

function chunk(entityType, records) {
  return { schemaVersion: 2, entityType, chunk: 1, maxRecords: 250, records };
}

function evidence(sourceId, fields, note) {
  return [{ sourceId, fields, status: "verified", confidence: "official", note }];
}

function sourceAlias(value) {
  return { value, kind: "localized", safe: true, language: "zh-CN", market: "China", sourceIds: [SPEC_SOURCE_ID] };
}

export async function buildWulingVictory280tBatch({ verifiedAt = "2026-08-17" } = {}) {
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
      title: "Wuling’s Two-Pronged Brand Strategy and New Models Introduced",
      publisher: "General Motors / SAIC-GM-Wuling",
      url: "https://news.gm.com.cn/en/home.detail.html/Pages/news/cn/en/2022/Feb/0223-wuling.html",
      documentId: "GM China Wuling Victory 2022-02-23 EN",
      documentDate: "2022-02-23",
      verifiedAt,
      market: "China",
      language: "en",
      supportedFields: ["canonicalName", "bodyTypes", "name", "productionFrom", "yearFrom", "market", "bodyType", "powertrainKind", "transmission"],
      confidence: "official",
      status: "active",
      license: null,
      notes: "Official English release establishes Victory as the public English name and records two 280T MPV variants launched on 2022-02-22 with an upgraded 1.5L turbocharged direct-injection engine.",
    },
    {
      id: ZH_SOURCE_ID,
      type: "manufacturer",
      title: "五菱2022品牌战略开启，五菱凯捷 280T上市",
      publisher: "General Motors / SAIC-GM-Wuling",
      url: "https://news.gm.com.cn/zh/home.detail.html/Pages/news/cn/zh/2022/Feb/0222-wuling.html",
      documentId: "GM China Wuling Kaijie 280T 2022-02-22 ZH",
      documentDate: "2022-02-22",
      verifiedAt,
      market: "China",
      language: "zh-CN",
      supportedFields: ["name", "yearFrom", "market", "bodyType", "powertrainKind", "transmission", "powerHp", "powerHpStandard"],
      confidence: "official",
      status: "active",
      license: null,
      notes: "Official Chinese launch names the Premium and Flagship CVT variants and gives the 177 PS output for the upgraded 1.5T engine.",
    },
    {
      id: SPEC_SOURCE_ID,
      type: "manufacturer_technical_document",
      title: "五菱凯捷参数配置",
      publisher: "SAIC-GM-Wuling Automobile Co., Ltd. (SGMW)",
      url: "https://www.sgmw.com.cn/carDetail?id=21",
      documentId: "SGMW carDetail 21",
      documentDate: null,
      verifiedAt,
      market: "China",
      language: "zh-CN",
      supportedFields: ["name", "market", "bodyType", "powertrainKind", "engineCc", "transmission", "drive", "icePowerKw", "lengthMm", "widthMm", "heightMm", "wheelbaseMm", "curbWeightKg", "tankCapacityL", "seats", "topSpeedKmh"],
      confidence: "official",
      status: "active",
      license: null,
      notes: "Exact eight-column manufacturer table; this batch transcribes only the two 280T columns explicitly tied to the February 2022 launch.",
    },
  ];
  const sources = sourceDefinitions.filter((source) => !sourceIds.has(source.id));

  const replacementModel = {
    ...existingModel,
    canonicalName: "Victory",
    slug: "victory",
    aliases: [
      ...existingModel.aliases.filter((item) => item.value !== "Kaijie"),
      { value: "Kaijie", kind: "transliteration", safe: true, language: "zh-Latn", market: "China", sourceIds: [CURRENT_CHINESE_SOURCE_ID] },
    ],
    bodyTypes: [...new Set([...existingModel.bodyTypes, "MPV"])],
    evidence: [
      ...existingModel.evidence,
      ...evidence(EN_SOURCE_ID, ["canonicalName", "bodyTypes"], "Official English manufacturer release calls this China-market model Wuling Victory and identifies it as an MPV."),
    ],
    researchNotes: [
      ...existingModel.researchNotes,
      "Canonical public name corrected from review-only Kaijie romanization to official English Victory; Kaijie remains a safe searchable alias.",
      "Only the two 280T grades explicitly tied to the 2022 launch are staged below; later technical-table editions require their own dated source before year assignment.",
    ],
    updatedAt: verifiedAt,
  };

  const generations = generationIds.has(GENERATION_ID) ? [] : [{
    id: GENERATION_ID,
    modelId: MODEL_ID,
    name: "280T (2022)",
    aliases: [],
    platformCodes: [],
    productionFrom: "2022-02",
    productionTo: null,
    bodyTypes: ["MPV"],
    status: "review",
    evidence: evidence(EN_SOURCE_ID, ["name", "productionFrom", "bodyTypes"], "Official English release records two Victory 280T MPV variants launched on 2022-02-22."),
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
      aliases: [sourceAlias(definition.sourceName)],
      market: "China",
      yearFrom: 2022,
      yearTo: null,
      bodyType: "MPV",
      powertrainKind: "ICE",
      engineCc: 1498,
      transmission: "CVT",
      drive: "FWD",
      powerHp: 177,
      powerHpStandard: "PS",
      icePowerKw: 130,
      lengthMm: 4875,
      widthMm: 1880,
      heightMm: 1700,
      wheelbaseMm: 2800,
      curbWeightKg: 1700,
      tankCapacityL: 56,
      seats: 6,
      topSpeedKmh: 170,
      status: "review",
      evidence: [
        ...evidence(EN_SOURCE_ID, ["yearFrom", "market", "bodyType", "powertrainKind", "transmission"], "Official English release establishes the two China-market Victory 280T CVT MPV variants launched in February 2022."),
        ...evidence(ZH_SOURCE_ID, ["name", "yearFrom", "market", "bodyType", "powertrainKind", "transmission", "powerHp", "powerHpStandard"], "Official Chinese launch supplies the two exact source-grade names and directly states 177 PS; horsepower is not calculated from kW."),
        ...evidence(SPEC_SOURCE_ID, ["name", "market", "bodyType", "powertrainKind", "engineCc", "transmission", "drive", "icePowerKw", "lengthMm", "widthMm", "heightMm", "wheelbaseMm", "curbWeightKg", "tankCapacityL", "seats", "topSpeedKmh"], "Exact values are transcribed from the corresponding 280T columns of the current SGMW technical table; front-engine/front-wheel drive is normalized to FWD."),
      ],
      researchNotes: [
        "The table describes a CVT with eight simulated ratios; no conventional gear count is stored.",
        "No fuel type is stored because the selected official records do not label the fuel field explicitly.",
        "No legal 30-minute power is inferred from combustion-engine power.",
      ],
      updatedAt: verifiedAt,
    }));

  const report = {
    schemaVersion: 2,
    generatedAt: verifiedAt,
    productionConnected: false,
    totals: { newSources: sources.length, replacedModels: 1, newGenerations: generations.length, newVariants: variants.length },
    modelId: MODEL_ID,
    canonicalName: "Victory",
    retainedAliases: ["Kaijie", "五菱 凯捷"],
    generationIds: [GENERATION_ID],
    variantIds: variants.map((record) => record.id),
    policy: {
      officialEnglishCanonicalName: true,
      exactDatedLaunchGradesOnly: true,
      localizedSourceNamesRetainedAsAliases: true,
      directOfficialPsNotConverted: true,
      simulatedCvtRatiosNotStoredAsGears: true,
      power30MinNotInferred: true,
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
  const { report, ingestion } = await buildWulingVictory280tBatch();
  await writeJson(REPORT_FILE, report);
  await writeJson(INGEST_FILE, ingestion);
  console.log(JSON.stringify(report.totals, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
