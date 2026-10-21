import path from "node:path";
import { pathToFileURL } from "node:url";
import { WORKSPACE_ROOT, writeJson } from "./lib.mjs";
import { buildJapanOfficialMassModelBatchFromDefinitions } from "./build-japan-official-mass-model-batch-02.mjs";

const REPORT_FILE = path.join(WORKSPACE_ROOT, "reports/model-japan-official-mass-market-13.json");
const INGEST_FILE = path.join(WORKSPACE_ROOT, "ingest/models-japan-official-mass-market-13-2026-08-17.json");

const REVIEWED_MODELS = [
  {
    id: "audi/tt-rs",
    canonicalName: "TT RS",
    mlitSourceNames: ["TTRS Coupe", "TTRS Coupé (S-tronic)", "TTRS Roadster"],
    url: "https://www.audi-mediacenter.com/en/photos/detail/audi-tt-rs-coupe-31249",
    publisher: "AUDI AG",
    language: "en",
    sourceScope: "archive",
    sourceTitle: "Audi official MediaCenter: TT RS Coupé",
    sourceNotes: "Audi's official MediaCenter identifies TT RS Coupé. Body and transmission suffixes remain exact MLIT source spellings."
  },
  {
    id: "bmw/6-series",
    canonicalName: "6 Series",
    mlitSourceNames: ["BMW 630i グラン ツーリスモ"],
    url: "https://www.press.bmwgroup.com/global/article/detail/T0308711EN/the-new-bmw-6-series-gran-turismo",
    publisher: "BMW AG",
    language: "en",
    sourceScope: "archive",
    sourceTitle: "BMW Group official archive: new BMW 6 Series Gran Turismo",
    sourceNotes: "BMW Group's official archive identifies the 6 Series model family. Body and engine suffixes remain source spellings."
  },
  {
    id: "bmw/7-series",
    canonicalName: "7 Series",
    mlitSourceNames: ["BMW 740i"],
    url: "https://www.press.bmwgroup.com/global/article/detail/T0221224EN/the-new-bmw-7-series",
    publisher: "BMW AG",
    language: "en",
    sourceScope: "archive",
    sourceTitle: "BMW Group official archive: new BMW 7 Series",
    sourceNotes: "BMW Group's official archive identifies the 7 Series model family. Engine and wheelbase suffixes remain source spellings."
  },
  {
    id: "bmw/8-series",
    canonicalName: "8 Series",
    mlitSourceNames: ["BMW 840i クーペ"],
    url: "https://www.press.bmwgroup.com/global/article/detail/T0281744EN/the-all-new-bmw-8-series-coupe",
    publisher: "BMW AG",
    language: "en",
    sourceScope: "archive",
    sourceTitle: "BMW Group official archive: all-new BMW 8 Series Coupé",
    sourceNotes: "BMW Group's official archive identifies the 8 Series model family. Body and engine suffixes remain source spellings."
  },
  {
    id: "mini/paceman",
    canonicalName: "Paceman",
    mlitBrandId: "bmw",
    mlitSourceNames: ["MINI Cooper ペースマン"],
    url: "https://www.press.bmwgroup.com/global/article/detail/T0131303EN/the-mini-paceman",
    publisher: "BMW AG",
    language: "en",
    sourceScope: "archive",
    sourceTitle: "BMW Group official archive: MINI Paceman",
    sourceNotes: "BMW Group's official MINI archive identifies Paceman. Cooper, Cooper S, diesel and JCW labels remain source spellings below the model identity."
  },
  {
    id: "mercedes-benz/g-class",
    canonicalName: "G-Class",
    mlitSourceNames: ["G350d"],
    url: "https://media.mercedes-benz.com/en/article/a8c745a2-842e-4479-a8c5-26ba3bec2964",
    publisher: "Mercedes-Benz AG",
    language: "en",
    sourceScope: "current",
    sourceTitle: "Mercedes-Benz official media: G-Class family",
    sourceNotes: "Mercedes-Benz's official media site identifies the G-Class model family. Powertrain and AMG suffixes remain exact source spellings."
  },
  {
    id: "mercedes-benz/r-class",
    canonicalName: "R-Class",
    mlitSourceNames: ["R350 4MATIC"],
    url: "https://mercedes-benz-publicarchive.com/marsClassic/en/instance/print/R-Class.xhtml?ls=L2RlL2luc3RhbmNlL2tvLnhodG1sP3JlbElkPTEwMDEmZnJvbU9pZD00NTMzMjEmcmVzdWx0SW5mb1R5cGVJZD0xNzUmdmlld1R5cGU9dGh1bWJzJnNvcnREZWZpbml0aW9uPW1hbnVhbHNvcnQtMSZvaWQ9NDUzMzIxJnRodW1iU2NhbGVJbmRleD0xJnJvd0NvdW50c0luZGV4PTUmZnJvbUluZm9UeXBlSWQ9MjI0NQ%21%21&oid=177993303&rs=1",
    publisher: "Mercedes-Benz AG",
    language: "en",
    sourceScope: "archive",
    sourceTitle: "Mercedes-Benz public archive: R-Class",
    sourceNotes: "Mercedes-Benz's public archive identifies the R-Class family. Technical values and production boundaries are not copied into this identity-only batch."
  },
  {
    id: "mercedes-benz/s-class",
    canonicalName: "S-Class",
    mlitSourceNames: ["S450"],
    url: "https://media.mercedes-benz.com/en/press-kit/71dc2a9c-34c7-47e0-a264-d39d89b85d4c/article/8e671658-cf56-45c3-8ba7-15e997dee179",
    publisher: "Mercedes-Benz AG",
    language: "en",
    sourceScope: "current",
    sourceTitle: "Mercedes-Benz official media: new S-Class",
    sourceNotes: "Mercedes-Benz's official media site identifies the S-Class model family. Powertrain, wheelbase, body and AMG labels remain exact source spellings."
  }
];

export async function buildJapanOfficialMassModelBatch13(options = {}) {
  return buildJapanOfficialMassModelBatchFromDefinitions(REVIEWED_MODELS, options);
}

async function main() {
  const { report, ingestion } = await buildJapanOfficialMassModelBatch13();
  await writeJson(REPORT_FILE, report);
  await writeJson(INGEST_FILE, ingestion);
  console.log(JSON.stringify(report.totals, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
