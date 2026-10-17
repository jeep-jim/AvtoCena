import path from "node:path";
import { pathToFileURL } from "node:url";
import { WORKSPACE_ROOT, writeJson } from "./lib.mjs";
import { buildJapanOfficialMassModelBatchFromDefinitions } from "./build-japan-official-mass-model-batch-02.mjs";

const REPORT_FILE = path.join(WORKSPACE_ROOT, "reports/model-japan-official-mass-market-05.json");
const INGEST_FILE = path.join(WORKSPACE_ROOT, "ingest/models-japan-official-mass-market-05-2026-08-17.json");

const archive = {
  sourceScope: "archive",
  sourceNotes: "The official manufacturer archive or news release identifies this Japan-market model. Exact generation and production boundaries are not inferred from the page."
};

const REVIEWED_MODELS = [
  { ...archive, id: "nissan/nv100-clipper-rio", canonicalName: "NV100 Clipper Rio", officialSourceName: "NV100クリッパー リオ", mlitSourceNames: ["NV100 クリッパーリオ"], url: "https://history.nissan.co.jp/NV100CLIPPERRIO/WZA0/1312/", publisher: "Nissan Motor Co., Ltd." },
  { id: "nissan/clipper-rio", canonicalName: "CLIPPER RIO", officialSourceName: "クリッパーリオ", mlitSourceNames: ["クリッパーリオ"], url: "https://www3.nissan.co.jp/vehicles/new/clipperrio.html", publisher: "Nissan Motor Co., Ltd." },
  { ...archive, id: "nissan/wingroad", canonicalName: "WINGROAD", officialSourceName: "ウイングロード", mlitSourceNames: ["ウィングロード"], url: "https://history.nissan.co.jp/WINGROAD/Y12/0511/index.html", publisher: "Nissan Motor Co., Ltd." },
  { ...archive, id: "nissan/sylphy", canonicalName: "SYLPHY", officialSourceName: "シルフィ", mlitSourceNames: ["シルフィ"], url: "https://history.nissan.co.jp/SYLPHY/B17/1212/index.html", publisher: "Nissan Motor Co., Ltd." },
  { ...archive, id: "nissan/dayz-roox", canonicalName: "DAYZ ROOX", officialSourceName: "デイズ ルークス", mlitSourceNames: ["デイズ ルークス", "デイズルークス"], url: "https://history.nissan.co.jp/DAYZROOX/BA0/1612/index.html", publisher: "Nissan Motor Co., Ltd." },
  { ...archive, id: "nissan/moco", canonicalName: "MOCO", officialSourceName: "モコ", mlitSourceNames: ["モコ"], url: "https://history.nissan.co.jp/MOCO/SA2/1310/index.html", publisher: "Nissan Motor Co., Ltd." },
  { ...archive, id: "nissan/lafesta", canonicalName: "Lafesta", officialSourceName: "ラフェスタ ハイウェイスター", mlitSourceNames: ["ラフェスタ"], url: "https://history.nissan.co.jp/LAFESTA/B35/1302/index.html", publisher: "Nissan Motor Co., Ltd." },
  { ...archive, id: "mazda/biante", canonicalName: "Biante", mlitSourceNames: ["ビアンテ"], url: "https://newsroom.mazda.com/en/publicity/release/2008/200805/080509a.html", publisher: "Mazda Motor Corporation" },
  { ...archive, id: "mazda/premacy", canonicalName: "Premacy", mlitSourceNames: ["プレマシー"], url: "https://newsroom.mazda.com/en/publicity/release/2010/201007/100701a.html", publisher: "Mazda Motor Corporation" },
  { ...archive, id: "mazda/verisa", canonicalName: "Verisa", mlitSourceNames: ["ベリーサ"], url: "https://newsroom.mazda.com/en/publicity/release/2004/200406/0628e.html", publisher: "Mazda Motor Corporation" },
  { ...archive, id: "suzuki/mr-wagon", canonicalName: "MR Wagon", mlitSourceNames: ["MRワゴン"], url: "https://www.globalsuzuki.com/globalnews/2001/1024_5.html", publisher: "Suzuki Motor Corporation" },
  { ...archive, id: "suzuki/kizashi", canonicalName: "Kizashi", mlitSourceNames: ["キザシ"], url: "https://www.globalsuzuki.com/globalnews/2009/1021b.html", publisher: "Suzuki Motor Corporation" },
  { ...archive, id: "suzuki/splash", canonicalName: "Splash", mlitSourceNames: ["スプラッシュ"], url: "https://www.globalsuzuki.com/globalnews/2008/1021.html", publisher: "Suzuki Motor Corporation" }
];

export async function buildJapanOfficialMassModelBatch05(options = {}) {
  return buildJapanOfficialMassModelBatchFromDefinitions(REVIEWED_MODELS, options);
}

async function main() {
  const { report, ingestion } = await buildJapanOfficialMassModelBatch05();
  await writeJson(REPORT_FILE, report);
  await writeJson(INGEST_FILE, ingestion);
  console.log(JSON.stringify(report.totals, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
