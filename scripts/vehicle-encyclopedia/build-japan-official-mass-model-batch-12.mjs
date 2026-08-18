import path from "node:path";
import { pathToFileURL } from "node:url";
import { WORKSPACE_ROOT, writeJson } from "./lib.mjs";
import { buildJapanOfficialMassModelBatchFromDefinitions } from "./build-japan-official-mass-model-batch-02.mjs";

const REPORT_FILE = path.join(WORKSPACE_ROOT, "reports/model-japan-official-mass-market-12.json");
const INGEST_FILE = path.join(WORKSPACE_ROOT, "ingest/models-japan-official-mass-market-12-2026-08-17.json");

const REVIEWED_MODELS = [{
  id: "volvo/v40-cross-country",
  canonicalName: "V40 Cross Country",
  mlitSourceNames: ["ボルボV40クロスカントリー"],
  url: "https://www.media.volvocars.com/global/en-gb/media/pressreleases/190783/volvo-v40-cross-country-model-year-20178",
  publisher: "Volvo Car Corporation",
  language: "en",
  sourceScope: "archive",
  sourceTitle: "Volvo Cars official archive: V40 Cross Country model year 2017",
  sourceNotes: "Volvo Cars' official media archive identifies V40 Cross Country. Production dates and technical specifications are not copied into this identity-only batch."
}];

export async function buildJapanOfficialMassModelBatch12(options = {}) {
  return buildJapanOfficialMassModelBatchFromDefinitions(REVIEWED_MODELS, options);
}

async function main() {
  const { report, ingestion } = await buildJapanOfficialMassModelBatch12();
  await writeJson(REPORT_FILE, report);
  await writeJson(INGEST_FILE, ingestion);
  console.log(JSON.stringify(report.totals, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
