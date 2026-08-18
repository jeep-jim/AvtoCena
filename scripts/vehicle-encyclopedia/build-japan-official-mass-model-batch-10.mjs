import path from "node:path";
import { pathToFileURL } from "node:url";
import { WORKSPACE_ROOT, writeJson } from "./lib.mjs";
import { buildJapanOfficialMassModelBatchFromDefinitions } from "./build-japan-official-mass-model-batch-02.mjs";

const REPORT_FILE = path.join(WORKSPACE_ROOT, "reports/model-japan-official-mass-market-10.json");
const INGEST_FILE = path.join(WORKSPACE_ROOT, "ingest/models-japan-official-mass-market-10-2026-08-17.json");

const REVIEWED_MODELS = [
  {
    id: "mitsubishi/delica-d3",
    canonicalName: "Delica D:3",
    officialSourceName: "デリカD：3",
    mlitSourceNames: ["デリカ D:3"],
    url: "https://ucar.mitsubishi-motors.co.jp/ucar/area/mMI/sS103",
    publisher: "Mitsubishi Motors Corporation",
    language: "ja",
    sourceScope: "archive",
    sourceTitle: "Mitsubishi official used-vehicle catalog: Delica D:3",
    sourceNotes: "Mitsubishi's official used-vehicle catalog identifies Delica D:3 as a Mitsubishi model. Only the identity is staged; listing specifications and production boundaries are not copied."
  }
];

export async function buildJapanOfficialMassModelBatch10(options = {}) {
  return buildJapanOfficialMassModelBatchFromDefinitions(REVIEWED_MODELS, options);
}

async function main() {
  const { report, ingestion } = await buildJapanOfficialMassModelBatch10();
  await writeJson(REPORT_FILE, report);
  await writeJson(INGEST_FILE, ingestion);
  console.log(JSON.stringify(report.totals, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
