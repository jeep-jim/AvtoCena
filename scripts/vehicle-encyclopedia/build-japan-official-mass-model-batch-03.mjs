import path from "node:path";
import { pathToFileURL } from "node:url";
import { WORKSPACE_ROOT, writeJson } from "./lib.mjs";
import { buildJapanOfficialMassModelBatchFromDefinitions } from "./build-japan-official-mass-model-batch-02.mjs";

const REPORT_FILE = path.join(WORKSPACE_ROOT, "reports/model-japan-official-mass-market-03.json");
const INGEST_FILE = path.join(WORKSPACE_ROOT, "ingest/models-japan-official-mass-market-03-2026-08-17.json");

const REVIEWED_MODELS = [
  { id: "toyota/century", canonicalName: "Century", officialSourceName: "センチュリー", mlitSourceNames: ["センチュリー"], url: "https://toyota.jp/century/", publisher: "Toyota Motor Corporation" },
  { id: "toyota/pixis-epoch", canonicalName: "Pixis Epoch", officialSourceName: "ピクシス エポック", mlitSourceNames: ["ピクシス エポック", "ピクシスエポック"], url: "https://toyota.jp/pixisepoch/", publisher: "Toyota Motor Corporation" },
  { id: "toyota/pixis-van", canonicalName: "Pixis Van", officialSourceName: "ピクシス バン", mlitSourceNames: [], url: "https://toyota.jp/pixisvan/", publisher: "Toyota Motor Corporation" },
  { id: "nissan/skyline", canonicalName: "SKYLINE", officialSourceName: "スカイライン", mlitSourceNames: ["スカイライン"], url: "https://www3.nissan.co.jp/vehicles/new/skyline.html", publisher: "Nissan Motor Co., Ltd." },
  { id: "suzuki/every", canonicalName: "Every", officialSourceName: "エブリイ", mlitSourceNames: ["エブリイ"], url: "https://www.suzuki.co.jp/car/every/", publisher: "Suzuki Motor Corporation" },
  { id: "suzuki/carry", canonicalName: "Carry", officialSourceName: "キャリイ", mlitSourceNames: [], url: "https://www.suzuki.co.jp/car/carry/", publisher: "Suzuki Motor Corporation" },
  { id: "mazda/scrum-wagon", canonicalName: "SCRUM WAGON", mlitSourceNames: [], url: "https://www.mazda.co.jp/cars/light-vehicle/scrum-wagon/", publisher: "Mazda Motor Corporation" },
  { id: "mazda/familia-van", canonicalName: "FAMILIA VAN", mlitSourceNames: [], url: "https://www.mazda.co.jp/cars/commercial/familia-van/", publisher: "Mazda Motor Corporation" },
  { id: "mazda/scrum-van", canonicalName: "SCRUM VAN", mlitSourceNames: [], url: "https://www.mazda.co.jp/cars/commercial/scrum-van/", publisher: "Mazda Motor Corporation" },
  { id: "mazda/bongo-van", canonicalName: "BONGO VAN", mlitSourceNames: [], url: "https://www.mazda.co.jp/cars/commercial/bongo-van/", publisher: "Mazda Motor Corporation" },
  { id: "subaru/stella", canonicalName: "Stella", officialSourceName: "ステラ", mlitSourceNames: ["ステラ"], url: "https://www.subaru.jp/stella/", publisher: "Subaru Corporation" },
  { id: "daihatsu/copen", canonicalName: "Copen", officialSourceName: "コペン", mlitSourceNames: ["コペン"], url: "https://www.daihatsu.co.jp/lineup/copen/", publisher: "Daihatsu Motor Co., Ltd." },
  { id: "daihatsu/atrai", canonicalName: "Atrai", officialSourceName: "アトレー", mlitSourceNames: [], url: "https://www.daihatsu.co.jp/lineup/atrai/", publisher: "Daihatsu Motor Co., Ltd." },
  { id: "honda/n-van", canonicalName: "N-VAN", mlitSourceNames: [], url: "https://www.honda.co.jp/N-VAN/", publisher: "Honda Motor Co., Ltd." },
  { id: "honda/n-van-e", canonicalName: "N-VAN e:", mlitSourceNames: [], url: "https://www.honda.co.jp/N-VAN-e/", publisher: "Honda Motor Co., Ltd." }
];

export async function buildJapanOfficialMassModelBatch03(options = {}) {
  return buildJapanOfficialMassModelBatchFromDefinitions(REVIEWED_MODELS, options);
}

async function main() {
  const { report, ingestion } = await buildJapanOfficialMassModelBatch03();
  await writeJson(REPORT_FILE, report);
  await writeJson(INGEST_FILE, ingestion);
  console.log(JSON.stringify(report.totals, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
