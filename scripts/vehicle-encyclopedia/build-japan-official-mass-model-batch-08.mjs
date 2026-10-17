import path from "node:path";
import { pathToFileURL } from "node:url";
import { WORKSPACE_ROOT, writeJson } from "./lib.mjs";
import { buildJapanOfficialMassModelBatchFromDefinitions } from "./build-japan-official-mass-model-batch-02.mjs";

const REPORT_FILE = path.join(WORKSPACE_ROOT, "reports/model-japan-official-mass-market-08.json");
const INGEST_FILE = path.join(WORKSPACE_ROOT, "ingest/models-japan-official-mass-market-08-2026-08-17.json");

const archive = {
  sourceScope: "archive",
  sourceNotes: "The official manufacturer archive identifies this model in the Japan priority window. Only the model identity is staged; inventory observation years are not treated as production boundaries."
};

const REVIEWED_MODELS = [
  {
    ...archive,
    id: "toyota/corolla-rumion",
    canonicalName: "Corolla Rumion",
    mlitSourceNames: ["カローラ ルミオン"],
    url: "https://global.toyota/en/detail/62516",
    publisher: "Toyota Motor Corporation",
    language: "en",
    sourceTitle: "Toyota Corolla: World's Most Popular Car"
  },
  {
    ...archive,
    id: "mitsubishi/proudia",
    canonicalName: "Proudia",
    mlitSourceNames: ["プラウディア"],
    url: "https://www.mitsubishi-motors.com/en/company/history/car/?year=1960s",
    officialSourceId: "src-mitsubishi-car-history-model-identities-2026",
    publisher: "Mitsubishi Motors Corporation",
    language: "en",
    sourceTitle: "Mitsubishi Motors official car history"
  },
  {
    ...archive,
    id: "mitsubishi/dignity",
    canonicalName: "Dignity",
    mlitSourceNames: ["ディグニティ"],
    url: "https://www.mitsubishi-motors.com/en/company/history/car/?year=1960s",
    officialSourceId: "src-mitsubishi-car-history-model-identities-2026",
    publisher: "Mitsubishi Motors Corporation",
    language: "en",
    sourceTitle: "Mitsubishi Motors official car history"
  },
  {
    ...archive,
    id: "mitsubishi/lancer-evolution",
    canonicalName: "Lancer Evolution",
    mlitSourceNames: ["ランサーエボ", "ランサーエボリューション"],
    url: "https://www.mitsubishi-motors.com/en/company/history/car/?year=1960s",
    officialSourceId: "src-mitsubishi-car-history-model-identities-2026",
    publisher: "Mitsubishi Motors Corporation",
    language: "en",
    sourceTitle: "Mitsubishi Motors official car history"
  }
];

export async function buildJapanOfficialMassModelBatch08(options = {}) {
  return buildJapanOfficialMassModelBatchFromDefinitions(REVIEWED_MODELS, options);
}

async function main() {
  const { report, ingestion } = await buildJapanOfficialMassModelBatch08();
  await writeJson(REPORT_FILE, report);
  await writeJson(INGEST_FILE, ingestion);
  console.log(JSON.stringify(report.totals, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
