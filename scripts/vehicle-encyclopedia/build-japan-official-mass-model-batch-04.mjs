import path from "node:path";
import { pathToFileURL } from "node:url";
import { WORKSPACE_ROOT, writeJson } from "./lib.mjs";
import { buildJapanOfficialMassModelBatchFromDefinitions } from "./build-japan-official-mass-model-batch-02.mjs";

const REPORT_FILE = path.join(WORKSPACE_ROOT, "reports/model-japan-official-mass-market-04.json");
const INGEST_FILE = path.join(WORKSPACE_ROOT, "ingest/models-japan-official-mass-market-04-2026-08-17.json");

const archive = {
  sourceScope: "archive",
  sourceNotes: "The official manufacturer archive or news release identifies this Japan-market model. Exact generation and production boundaries are not inferred from the page."
};

const REVIEWED_MODELS = [
  { ...archive, id: "toyota/corolla-axio", canonicalName: "Corolla Axio", officialSourceName: "カローラ アクシオ", mlitSourceNames: ["カローラ アクシオ"], url: "https://global.toyota/jp/newsroom/toyota/21803537.html", publisher: "Toyota Motor Corporation" },
  { ...archive, id: "toyota/corolla-fielder", canonicalName: "Corolla Fielder", officialSourceName: "カローラ フィールダー", mlitSourceNames: ["カローラ フィールダー"], url: "https://global.toyota/jp/newsroom/toyota/21803537.html", publisher: "Toyota Motor Corporation" },
  { ...archive, id: "toyota/passo", canonicalName: "Passo", officialSourceName: "パッソ", mlitSourceNames: ["パッソ", "パッソ *"], url: "https://global.toyota/en/newsroom/toyota/23323667.html", publisher: "Toyota Motor Corporation" },
  { ...archive, id: "toyota/pixis-joy", canonicalName: "Pixis Joy", officialSourceName: "ピクシス ジョイ", mlitSourceNames: ["ピクシス ジョイ"], url: "https://global.toyota/en/newsroom/toyota/23655622.html", publisher: "Toyota Motor Corporation" },
  { ...archive, id: "toyota/pixis-mega", canonicalName: "Pixis Mega", officialSourceName: "ピクシス メガ", mlitSourceNames: ["ピクシス メガ"], url: "https://global.toyota/en/newsroom/toyota/23657146.html", publisher: "Toyota Motor Corporation" },
  { ...archive, id: "toyota/vitz", canonicalName: "Vitz", officialSourceName: "ヴィッツ", mlitSourceNames: ["ヴィッツ"], url: "https://global.toyota/en/newsroom/toyota/24129866.html", publisher: "Toyota Motor Corporation" },
  { ...archive, id: "toyota/estima", canonicalName: "Estima", officialSourceName: "エスティマ", mlitSourceNames: ["エスティマ", "エスティマ ハイブリッド"], url: "https://global.toyota/jp/newsroom/toyota/21815543.html", publisher: "Toyota Motor Corporation" },
  { ...archive, id: "toyota/mark-x", canonicalName: "Mark X", officialSourceName: "マークX", mlitSourceNames: ["マークX"], url: "https://global.toyota/jp/newsroom/toyota/21821005.html", publisher: "Toyota Motor Corporation" },
  { ...archive, id: "toyota/isis", canonicalName: "Isis", officialSourceName: "アイシス", mlitSourceNames: ["アイシス"], url: "https://global.toyota/jp/newsroom/toyota/21813594.html", publisher: "Toyota Motor Corporation" },
  { ...archive, id: "toyota/avensis", canonicalName: "Avensis", officialSourceName: "アベンシス", mlitSourceNames: [], url: "https://global.toyota/jp/newsroom/toyota/21815164.html", publisher: "Toyota Motor Corporation" },
  { ...archive, id: "toyota/porte", canonicalName: "Porte", officialSourceName: "ポルテ", mlitSourceNames: [], url: "https://global.toyota/jp/newsroom/toyota/21817332.html", publisher: "Toyota Motor Corporation" },
  { ...archive, id: "toyota/spade", canonicalName: "Spade", officialSourceName: "スペイド", mlitSourceNames: [], url: "https://global.toyota/jp/newsroom/toyota/21817332.html", publisher: "Toyota Motor Corporation" },
  { ...archive, id: "toyota/granace", canonicalName: "GranAce", officialSourceName: "グランエース", mlitSourceNames: ["グランエース"], url: "https://global.toyota/jp/newsroom/toyota/35371505.html", publisher: "Toyota Motor Corporation" },
  { ...archive, id: "toyota/copen", canonicalName: "Copen", officialSourceName: "コペン", mlitSourceNames: ["コペン"], url: "https://global.toyota/jp/newsroom/toyota/29933518.html", publisher: "Toyota Motor Corporation" },
  { ...archive, id: "toyota/wish", canonicalName: "Wish", officialSourceName: "ウィッシュ", mlitSourceNames: ["ウィッシュ"], url: "https://global.toyota/jp/newsroom/toyota/21804622.html", publisher: "Toyota Motor Corporation" },
  { ...archive, id: "daihatsu/boon", canonicalName: "Boon", officialSourceName: "ブーン", mlitSourceNames: ["ブーン"], url: "https://www.daihatsu.com/news/2016/20160412-2.html", publisher: "Daihatsu Motor Co., Ltd." },
  { ...archive, id: "daihatsu/cast", canonicalName: "Cast", officialSourceName: "キャスト", mlitSourceNames: ["キャスト"], url: "https://www.daihatsu.com/news/2015/20150909-2.html", publisher: "Daihatsu Motor Co., Ltd." },
  { ...archive, id: "daihatsu/mira-tocot", canonicalName: "Mira Tocot", officialSourceName: "ミラ トコット", mlitSourceNames: ["ミラ トコット"], url: "https://www.daihatsu.com/news/2018/20180625-2.html", publisher: "Daihatsu Motor Co., Ltd." },
  { ...archive, id: "daihatsu/wake", canonicalName: "Wake", officialSourceName: "ウェイク", mlitSourceNames: ["ウェイク"], url: "https://www.daihatsu.com/news/2016/20160517-2.html", publisher: "Daihatsu Motor Co., Ltd." },
  { ...archive, id: "nissan/fuga", canonicalName: "FUGA", officialSourceName: "フーガ", mlitSourceNames: ["フーガ"], url: "https://history.nissan.co.jp/FUGA/Y51/1502/index.html", publisher: "Nissan Motor Co., Ltd." },
  { ...archive, id: "nissan/cima", canonicalName: "CIMA", officialSourceName: "シーマ", mlitSourceNames: ["シーマ"], url: "https://history.nissan.co.jp/CIMA/GY51/1706/index.html", publisher: "Nissan Motor Co., Ltd." },
  { ...archive, id: "nissan/cube", canonicalName: "CUBE", officialSourceName: "キューブ", mlitSourceNames: ["キューブ"], url: "https://history.nissan.co.jp/CUBE/Z12/1210/index.html", publisher: "Nissan Motor Co., Ltd." },
  { ...archive, id: "nissan/teana", canonicalName: "TEANA", officialSourceName: "ティアナ", mlitSourceNames: ["ティアナ"], url: "https://history.nissan.co.jp/TEANA/L33/1401/index.html", publisher: "Nissan Motor Co., Ltd." },
  { ...archive, id: "mitsubishi/pajero", canonicalName: "Pajero", officialSourceName: "パジェロ", mlitSourceNames: ["パ ジ ェ ロ", "パジェロ"], url: "https://www.mitsubishi-motors.com/en/newsroom/newsrelease/2023/20231107_1.html", publisher: "Mitsubishi Motors Corporation" }
];

export async function buildJapanOfficialMassModelBatch04(options = {}) {
  return buildJapanOfficialMassModelBatchFromDefinitions(REVIEWED_MODELS, options);
}

async function main() {
  const { report, ingestion } = await buildJapanOfficialMassModelBatch04();
  await writeJson(REPORT_FILE, report);
  await writeJson(INGEST_FILE, ingestion);
  console.log(JSON.stringify(report.totals, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
