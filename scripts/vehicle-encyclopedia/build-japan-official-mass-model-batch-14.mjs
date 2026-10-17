import path from "node:path";
import { pathToFileURL } from "node:url";
import { WORKSPACE_ROOT, writeJson } from "./lib.mjs";
import { buildJapanOfficialMassModelBatchFromDefinitions } from "./build-japan-official-mass-model-batch-02.mjs";

const REPORT_FILE = path.join(WORKSPACE_ROOT, "reports/model-japan-official-mass-market-14.json");
const INGEST_FILE = path.join(WORKSPACE_ROOT, "ingest/models-japan-official-mass-market-14-2026-08-17.json");

const REVIEWED_MODELS = [{
  id: "fiat/doblo",
  canonicalName: "Doblò",
  mlitSourceNames: ["ドブロ"],
  url: "https://www.media.stellantis.com/uk-en/fiat/press/new-fiat-dobl-unveiled",
  publisher: "Stellantis N.V.",
  language: "en",
  sourceScope: "archive",
  sourceTitle: "Fiat official archive: new Doblò",
  sourceNotes: "Fiat's official media archive identifies Doblò. Grades, engines and production boundaries are not copied into this identity-only batch."
}];

export async function buildJapanOfficialMassModelBatch14(options = {}) {
  return buildJapanOfficialMassModelBatchFromDefinitions(REVIEWED_MODELS, options);
}

async function main() {
  const { report, ingestion } = await buildJapanOfficialMassModelBatch14();
  await writeJson(REPORT_FILE, report);
  await writeJson(INGEST_FILE, ingestion);
  console.log(JSON.stringify(report.totals, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
