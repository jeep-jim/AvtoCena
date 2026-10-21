import path from "node:path";
import { pathToFileURL } from "node:url";
import { WORKSPACE_ROOT, writeJson } from "./lib.mjs";
import { buildJapanOfficialMassModelBatchFromDefinitions } from "./build-japan-official-mass-model-batch-02.mjs";

const REPORT_FILE = path.join(WORKSPACE_ROOT, "reports/model-japan-official-mass-market-09.json");
const INGEST_FILE = path.join(WORKSPACE_ROOT, "ingest/models-japan-official-mass-market-09-2026-08-17.json");

const archive = {
  sourceScope: "archive",
  sourceNotes: "The official manufacturer archive identifies this Japan-market model. Combined registry labels are not attached to one model; only explicit manufacturer spellings are safe aliases."
};

const REVIEWED_MODELS = [
  {
    ...archive,
    id: "toyota/premio",
    canonicalName: "Premio",
    officialSourceName: "プレミオ",
    mlitSourceNames: [],
    url: "https://global.toyota/en/newsroom/toyota/22792726.html",
    publisher: "Toyota Motor Corporation",
    language: "en",
    sourceTitle: "Toyota launches fully redesigned Premio and Allion"
  },
  {
    ...archive,
    id: "toyota/esquire",
    canonicalName: "Esquire",
    officialSourceName: "エスクァイア",
    mlitSourceNames: [],
    url: "https://global.toyota/en/newsroom/toyota/23437924.html",
    publisher: "Toyota Motor Corporation",
    language: "en",
    sourceTitle: "Toyota launches all-new Esquire deluxe minivan in Japan"
  },
  {
    ...archive,
    id: "toyota/crown-comfort",
    canonicalName: "Crown Comfort",
    officialSourceName: "クラウンコンフォート",
    mlitSourceNames: [],
    url: "https://global.toyota/en/detail/7912522",
    publisher: "Toyota Motor Corporation",
    language: "en",
    sourceTitle: "Toyota introduces Crown Comfort and Comfort for taxi use"
  },
  {
    ...archive,
    id: "toyota/tank",
    canonicalName: "Tank",
    officialSourceName: "タンク",
    mlitSourceNames: [],
    url: "https://global.toyota/en/newsroom/toyota/25527221.html",
    publisher: "Toyota Motor Corporation",
    language: "en",
    sourceTitle: "All New Toyota Roomy and Toyota Tank Compact Minivan"
  },
  {
    ...archive,
    id: "mazda/scrum",
    canonicalName: "Scrum",
    officialSourceName: "スクラム",
    mlitSourceNames: ["スクラム"],
    url: "https://newsroom.mazda.com/en/publicity/release/2000/200005/0524e.html",
    publisher: "Mazda Motor Corporation",
    language: "en",
    sourceTitle: "Mazda upgrades the Scrum series"
  }
];

export async function buildJapanOfficialMassModelBatch09(options = {}) {
  return buildJapanOfficialMassModelBatchFromDefinitions(REVIEWED_MODELS, options);
}

async function main() {
  const { report, ingestion } = await buildJapanOfficialMassModelBatch09();
  await writeJson(REPORT_FILE, report);
  await writeJson(INGEST_FILE, ingestion);
  console.log(JSON.stringify(report.totals, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
