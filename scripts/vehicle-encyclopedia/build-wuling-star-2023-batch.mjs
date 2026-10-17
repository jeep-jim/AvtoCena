import path from "node:path";
import { pathToFileURL } from "node:url";
import { WORKSPACE_ROOT, loadWorkspace, writeJson } from "./lib.mjs";

const REPORT_FILE = path.join(WORKSPACE_ROOT, "reports/wuling-star-2023-lineup.json");
const INGEST_FILE = path.join(WORKSPACE_ROOT, "ingest/wuling-star-2023-lineup-2026-08-17.json");
const MODEL_ID = "wuling/xingyun";
const GENERATION_ID = `${MODEL_ID}/launch-lineup-2023`;
const ENGLISH_SOURCE_ID = "src-gm-wuling-star-launch-en-2023";
const CHINESE_SOURCE_ID = "src-gm-wuling-xingyun-launch-zh-2023";
const CURRENT_CHINESE_SOURCE_ID = "src-sgmw-wuling-silver-current-zh-2026";

const VARIANTS = [
  { slug: "standard", sourceName: "标准型", name: "Standard" },
  { slug: "flagship", sourceName: "旗舰型", name: "Flagship" },
];

function chunk(entityType, records) {
  return { schemaVersion: 2, entityType, chunk: 1, maxRecords: 250, records };
}

function evidence(sourceId, fields, note) {
  return [{ sourceId, fields, status: "verified", confidence: "official", note }];
}

function localizedAlias(value) {
  return { value, kind: "localized", safe: true, language: "zh-CN", market: "China", sourceIds: [CHINESE_SOURCE_ID] };
}

export async function buildWulingStar2023Batch({ verifiedAt = "2026-08-17" } = {}) {
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
      title: "SAIC-GM-Wuling Launches All-New Wuling Star Compact SUV",
      publisher: "General Motors / SAIC-GM-Wuling",
      url: "https://news.gm.com.cn/en/home.detail.html/Pages/news/cn/en/2023/Sept/0920-wuling.html",
      documentId: "GM China Wuling 2023-09-20 EN",
      documentDate: "2023-09-20",
      verifiedAt,
      market: "China",
      language: "en",
      supportedFields: [
        "canonicalName", "name", "productionFrom", "bodyTypes", "powertrainKinds", "market", "yearFrom",
        "bodyType", "powertrainKind", "transmission", "lengthMm", "widthMm", "heightMm",
        "wheelbaseMm", "groundClearanceMm",
      ],
      confidence: "official",
      status: "active",
      license: null,
      notes: "Official English launch establishes Star as the public English model name and states the compact SUV's hybrid engine-battery-motor DHT layout and exact dimensions. Nominal 2.0 L is not converted to exact cc, and ambiguous maximum-power wording is not mapped.",
    },
    {
      id: CHINESE_SOURCE_ID,
      type: "manufacturer",
      title: "售价8.98万元起，“燃油SUV模范生”五菱星云正式上市",
      publisher: "General Motors / SAIC-GM-Wuling",
      url: "https://news.gm.com.cn/zh/home.detail.html/Pages/news/cn/zh/2023/Sept/0920-wuling.html",
      documentId: "GM China Wuling 2023-09-20 ZH",
      documentDate: "2023-09-20",
      verifiedAt,
      market: "China",
      language: "zh-CN",
      supportedFields: ["name", "market", "yearFrom"],
      confidence: "official",
      status: "active",
      license: null,
      notes: "Official Chinese launch names exactly two configurations: Standard and Flagship. Prices are evidence only and are not stored in the technical encyclopedia contract.",
    },
  ];
  const sources = sourceDefinitions.filter((source) => !sourceIds.has(source.id));

  const replacementModel = {
    ...existingModel,
    canonicalName: "Star",
    slug: "star",
    aliases: [
      ...existingModel.aliases.filter((item) => item.value !== "Xingyun"),
      {
        value: "Xingyun",
        kind: "transliteration",
        safe: true,
        language: "zh-Latn",
        market: "China",
        sourceIds: [CURRENT_CHINESE_SOURCE_ID],
      },
    ],
    productionFrom: "2023-09",
    bodyTypes: ["SUV"],
    powertrainKinds: ["HEV"],
    evidence: [
      ...existingModel.evidence,
      ...evidence(ENGLISH_SOURCE_ID, ["canonicalName", "productionFrom", "bodyTypes", "powertrainKinds"], "Official English launch uses Wuling Star and describes a compact hybrid SUV launched on 2023-09-20."),
    ],
    researchNotes: [
      ...existingModel.researchNotes,
      "Canonical public name corrected from a review-only romanization to SGMW's official English name Star; Xingyun remains a searchable transliteration alias.",
      "Two launch grades are staged below; publication and pricing remain disconnected.",
    ],
    updatedAt: verifiedAt,
  };

  const generations = generationIds.has(GENERATION_ID) ? [] : [{
    id: GENERATION_ID,
    modelId: MODEL_ID,
    name: "Launch lineup (2023)",
    aliases: [],
    platformCodes: [],
    productionFrom: "2023-09",
    productionTo: null,
    bodyTypes: ["SUV"],
    status: "review",
    evidence: evidence(ENGLISH_SOURCE_ID, ["name", "productionFrom", "bodyTypes"], "Official launch confirms the all-new compact SUV on 2023-09-20."),
    researchNotes: ["Launch-lineup container only; no unverified platform or internal generation code is inferred."],
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
      aliases: [localizedAlias(definition.sourceName)],
      market: "China",
      yearFrom: 2023,
      yearTo: null,
      bodyType: "SUV",
      powertrainKind: "HEV",
      transmission: "DHT",
      lengthMm: 4610,
      widthMm: 1810,
      heightMm: 1670,
      wheelbaseMm: 2700,
      groundClearanceMm: 178,
      status: "review",
      evidence: [
        ...evidence(CHINESE_SOURCE_ID, ["name", "market", "yearFrom"], "Official Chinese launch confirms this exact grade identity in the two-grade 2023 lineup."),
        ...evidence(ENGLISH_SOURCE_ID, ["bodyType", "powertrainKind", "transmission", "lengthMm", "widthMm", "heightMm", "wheelbaseMm", "groundClearanceMm"], "Official English model launch supplies the shared SUV hybrid DHT layout and exact exterior dimensions."),
      ],
      researchNotes: [
        "Nominal 2.0 L displacement is not converted to an exact engineCc value.",
        "The launch release's ambiguous 130 kW wording is intentionally not assigned to motorPeakKw, powerKw or legal 30-minute power.",
      ],
      updatedAt: verifiedAt,
    }));

  const report = {
    schemaVersion: 2,
    generatedAt: verifiedAt,
    productionConnected: false,
    totals: { newSources: sources.length, replacedModels: 1, newGenerations: generations.length, newVariants: variants.length },
    modelId: MODEL_ID,
    canonicalName: "Star",
    retainedAliases: ["Xingyun", "五菱 星云"],
    generationIds: [GENERATION_ID],
    variantIds: variants.map((record) => record.id),
    policy: {
      officialEnglishCanonicalName: true,
      localizedAndRomanizedAliasesRetained: true,
      exactLaunchGradesOnly: true,
      nominalDisplacementNotConverted: true,
      ambiguousPowerRejected: true,
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
  const { report, ingestion } = await buildWulingStar2023Batch();
  await writeJson(REPORT_FILE, report);
  await writeJson(INGEST_FILE, ingestion);
  console.log(JSON.stringify(report.totals, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
