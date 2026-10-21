import path from "node:path";
import { pathToFileURL } from "node:url";
import { WORKSPACE_ROOT, loadWorkspace, writeJson } from "./lib.mjs";

const REPORT_FILE = path.join(WORKSPACE_ROOT, "reports/sgmw-wuling-current-models-2026.json");
const INGEST_FILE = path.join(WORKSPACE_ROOT, "ingest/sgmw-wuling-current-models-2026-08-17.json");
const SILVER_EN_SOURCE = "src-sgmw-wuling-silver-current-en-2026";
const SILVER_ZH_SOURCE = "src-sgmw-wuling-silver-current-zh-2026";
const RED_ZH_SOURCE = "src-sgmw-wuling-red-current-zh-2026";

const DEFINITIONS = [
  ["starlight-l", "Starlight L", "五菱 星光L", [], SILVER_ZH_SOURCE],
  ["bingo-pro", "Bingo Pro", "五菱 缤果Pro", ["BEV"], SILVER_ZH_SOURCE],
  ["hongguang-mini-ev", "Hongguang MINI EV", "五菱 宏光MINIEV", ["BEV"], SILVER_EN_SOURCE],
  ["bingo", "Bingo", "五菱 缤果", ["BEV"], SILVER_EN_SOURCE],
  ["bingo-plus", "Bingo Plus", "五菱 缤果PLUS", ["BEV"], SILVER_EN_SOURCE],
  ["air-ev", "Air EV", "五菱 Air ev晴空", ["BEV"], SILVER_ZH_SOURCE],
  ["xingchi", "Xingchi", "五菱 星驰", ["ICE"], SILVER_ZH_SOURCE],
  ["xingchen", "Xingchen", "五菱 星辰", ["ICE", "HEV"], SILVER_ZH_SOURCE],
  ["jiachen", "Jiachen", "五菱 佳辰", ["ICE", "HEV"], SILVER_ZH_SOURCE],
  ["xingyun", "Xingyun", "五菱 星云", ["ICE"], SILVER_ZH_SOURCE],
  ["kaijie", "Kaijie", "五菱 凯捷", ["ICE", "HEV"], SILVER_ZH_SOURCE],
  ["hongguang", "Hongguang", "五菱 宏光", ["BEV", "EREV"], RED_ZH_SOURCE],
  ["rongguang", "Rongguang", "五菱 荣光", ["BEV", "ICE"], RED_ZH_SOURCE],
  ["zhiguang", "Zhiguang", "五菱 之光", ["BEV", "ICE"], RED_ZH_SOURCE],
  ["yangguang", "Yangguang", "五菱 扬光", ["BEV"], RED_ZH_SOURCE],
  ["hongguang-v", "Hongguang V", "五菱 宏光V", ["ICE"], RED_ZH_SOURCE],
  ["hongguang-s", "Hongguang S", "五菱 宏光S", ["ICE"], RED_ZH_SOURCE],
  ["hongguang-s3", "Hongguang S3", "五菱 宏光S3", ["ICE"], RED_ZH_SOURCE],
  ["hongguang-plus", "Hongguang Plus", "五菱 宏光PLUS", ["ICE"], RED_ZH_SOURCE],
  ["rongguang-s", "Rongguang S", "五菱 荣光S", ["ICE"], RED_ZH_SOURCE],
  ["rongguang-new-pickup", "Rongguang New Pickup", "五菱 荣光新卡", ["ICE"], RED_ZH_SOURCE],
  ["rongguang-pickup", "Rongguang Pickup", "五菱 荣光小卡", ["ICE"], RED_ZH_SOURCE],
  ["zhengcheng", "Zhengcheng", "五菱 征程", ["ICE"], RED_ZH_SOURCE],
  ["longka", "Longka", "五菱 龙卡", ["ICE"], RED_ZH_SOURCE],
];

function chunk(entityType, records) {
  return { schemaVersion: 2, entityType, chunk: 1, maxRecords: 250, records };
}

function sourceRecord({ id, title, url, language, notes }, verifiedAt) {
  return {
    id,
    type: "manufacturer",
    title,
    publisher: "SAIC-GM-Wuling Automobile Co., Ltd. (SGMW)",
    url,
    documentId: null,
    documentDate: null,
    verifiedAt,
    market: "China",
    language,
    supportedFields: ["canonicalName", "powertrainKinds"],
    confidence: "official",
    status: "active",
    license: null,
    notes,
  };
}

export async function buildSgmwWulingCurrentModelBatch({ verifiedAt = "2026-08-17" } = {}) {
  const workspace = await loadWorkspace();
  const existingSources = new Set(workspace.records.source.map((record) => record.id));
  const existingModels = new Set(workspace.records.model.map((record) => record.id));
  const allSources = [
    sourceRecord({
      id: SILVER_EN_SOURCE,
      title: "Wuling Silver current model portfolio",
      url: "https://www.sgmw.com.cn/en/wulingSilver",
      language: "en",
      notes: "Official English current-range page used for public Latin model identities and electric/hybrid portfolio grouping.",
    }, verifiedAt),
    sourceRecord({
      id: SILVER_ZH_SOURCE,
      title: "五菱银标当前车型阵容",
      url: "https://www.sgmw.com.cn/wulingSilverBadge",
      language: "zh-CN",
      notes: "Official China current-range page used for exact Chinese source spellings and portfolio powertrain grouping. Generic hybrid grouping is not forced into HEV/PHEV/EREV for Starlight-family records.",
    }, verifiedAt),
    sourceRecord({
      id: RED_ZH_SOURCE,
      title: "五菱红标当前车型阵容",
      url: "https://www.sgmw.com.cn/wulingRedBadge",
      language: "zh-CN",
      notes: "Official China current-range page used for exact current Wuling commercial/passenger family identities and explicit pure-electric, range-extender and fuel groupings.",
    }, verifiedAt),
  ];
  const sources = allSources.filter((source) => !existingSources.has(source.id));
  const models = DEFINITIONS.filter(([slug]) => !existingModels.has(`wuling/${slug}`)).map(([
    slug, canonicalName, localized, powertrainKinds, sourceId,
  ]) => ({
    id: `wuling/${slug}`,
    brandId: "wuling",
    canonicalName,
    slug,
    aliases: canonicalName === "Hongguang MINI EV" ? [{
      value: "Hongguang MINIEV",
      kind: "punctuation",
      safe: true,
      language: "en",
      market: "China",
      sourceIds: [SILVER_EN_SOURCE],
    }] : [],
    sourceNames: [{
      value: localized,
      kind: "localized",
      safe: true,
      language: "zh-CN",
      market: "China",
      sourceIds: [sourceId === SILVER_EN_SOURCE ? SILVER_ZH_SOURCE : sourceId],
    }],
    productionFrom: null,
    productionTo: null,
    bodyTypes: [],
    powertrainKinds,
    mediaIds: [],
    status: "review",
    evidence: [{
      sourceId,
      fields: ["canonicalName", ...(powertrainKinds.length ? ["powertrainKinds"] : [])],
      status: "verified",
      confidence: sourceId === SILVER_EN_SOURCE ? "official" : "high",
      note: sourceId === SILVER_EN_SOURCE
        ? "SGMW's official English current-range page supplies the public Latin identity and portfolio powertrain grouping."
        : "SGMW's official China current-range page supplies the exact source identity; the public Latin name is a conservative review-only romanization.",
    }],
    researchNotes: [
      "Current model identity only: production start, generation, body and exact specification require a model-specific manufacturer page before pricing use.",
      "Trim or generation labels such as Macaron, GAMEBOY, Cabrio and New Hongguang S are not duplicated as standalone models.",
    ],
    updatedAt: verifiedAt,
  })).sort((left, right) => left.id.localeCompare(right.id, "en"));

  const report = {
    schemaVersion: 2,
    generatedAt: verifiedAt,
    productionConnected: false,
    totals: { candidateModels: DEFINITIONS.length, newSources: sources.length, newModels: models.length },
    modelIds: models.map((model) => model.id),
    policy: {
      currentOfficialPortfolioOnly: true,
      englishPublicIdentityRequired: true,
      chineseSourceNamesSearchable: true,
      gradesAndGenerationsNotDuplicatedAsModels: true,
      unknownProductionDatesRejected: true,
      automaticPublicationReady: false,
    },
  };

  return {
    report,
    ingestion: {
      schemaVersion: 2,
      batches: [
        ...(sources.length ? [chunk("source", sources)] : []),
        ...(models.length ? [chunk("model", models)] : []),
      ],
    },
  };
}

async function main() {
  const { report, ingestion } = await buildSgmwWulingCurrentModelBatch();
  await writeJson(REPORT_FILE, report);
  await writeJson(INGEST_FILE, ingestion);
  console.log(JSON.stringify(report.totals, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
