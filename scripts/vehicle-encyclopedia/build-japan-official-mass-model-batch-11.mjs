import path from "node:path";
import { pathToFileURL } from "node:url";
import { WORKSPACE_ROOT, writeJson } from "./lib.mjs";
import { buildJapanOfficialMassModelBatchFromDefinitions } from "./build-japan-official-mass-model-batch-02.mjs";

const REPORT_FILE = path.join(WORKSPACE_ROOT, "reports/model-japan-official-mass-market-11.json");
const INGEST_FILE = path.join(WORKSPACE_ROOT, "ingest/models-japan-official-mass-market-11-2026-08-17.json");

const REVIEWED_MODELS = [
  {
    id: "lexus/gs",
    canonicalName: "GS",
    mlitSourceNames: ["GS200t", "GS250", "GS300", "GS300h", "GS350", "GS450h"],
    url: "https://global.toyota/en/detail/159124",
    publisher: "Toyota Motor Corporation",
    language: "en",
    sourceScope: "archive",
    sourceTitle: "Lexus official archive: new GS lineup in Japan",
    sourceNotes: "Toyota's official global newsroom identifies GS as the Lexus model family. Powertrain suffixes are retained only as exact MLIT source spellings."
  },
  {
    id: "lexus/hs",
    canonicalName: "HS",
    mlitSourceNames: ["HS250h"],
    url: "https://global.toyota/en/detail/309306",
    publisher: "Toyota Motor Corporation",
    language: "en",
    sourceScope: "archive",
    sourceTitle: "Lexus official archive: HS250h launch in Japan",
    sourceNotes: "Toyota's official global newsroom identifies HS250h. HS is staged as the English model family while the full badge remains an exact MLIT source spelling."
  },
  {
    id: "volvo/xc70",
    canonicalName: "XC70",
    mlitSourceNames: ["ボルボXC70"],
    url: "https://www.media.volvocars.com/global/en-gb/media/pressreleases/4978",
    publisher: "Volvo Car Corporation",
    language: "en",
    sourceScope: "archive",
    sourceTitle: "Volvo Cars official archive: XC70",
    sourceNotes: "Volvo Cars' official media archive identifies XC70. Production boundaries are not inferred from the archive article or MLIT inventory observations."
  },
  {
    id: "land-rover/freelander-2",
    canonicalName: "Freelander 2",
    mlitSourceNames: ["フリーランダー 2"],
    url: "https://media.landrover.com/news/2014/03/land-rover-introduces-new-hse-luxury-and-xs-specifications-freelander-2",
    publisher: "Jaguar Land Rover Limited",
    language: "en",
    sourceScope: "archive",
    sourceTitle: "Land Rover official archive: Freelander 2",
    sourceNotes: "Land Rover's official media archive identifies Freelander 2. Grades and production boundaries are not copied."
  },
  {
    id: "abarth/124-spider",
    canonicalName: "124 Spider",
    mlitSourceNames: ["Abarth 124 Spider"],
    url: "https://www.media.stellantis.com/uk-en/abarth/press/124-spider-makes-dynamic-debut-as-abarth-showcases-future-and-past-at-goodwood",
    publisher: "Stellantis N.V.",
    language: "en",
    sourceScope: "archive",
    sourceTitle: "Abarth official archive: 124 Spider",
    sourceNotes: "Abarth's official media archive identifies the 124 Spider. Specifications and production boundaries are not copied into this identity-only batch."
  },
  {
    id: "dodge/nitro",
    canonicalName: "Nitro",
    aliases: [{ value: "Nitro", kind: "source_spelling", safe: true, language: "en", market: "United States" }],
    mlitSourceNames: ["ナイトロ"],
    officialSourceId: "src-dodge-nitro-nhtsa-vpic-2026",
    sourceType: "government_registry",
    sourceMarket: "United States",
    url: "https://vpic.nhtsa.dot.gov/decoder/Manufacturer/Details/?IsExport=True&id=994",
    publisher: "National Highway Traffic Safety Administration",
    language: "en",
    sourceTitle: "NHTSA vPIC manufacturer record: Dodge Nitro",
    sourceNotes: "The official NHTSA manufacturer database lists Nitro under Dodge. The Japanese spelling is separately backed by exact MLIT observations."
  }
];

export async function buildJapanOfficialMassModelBatch11(options = {}) {
  return buildJapanOfficialMassModelBatchFromDefinitions(REVIEWED_MODELS, options);
}

async function main() {
  const { report, ingestion } = await buildJapanOfficialMassModelBatch11();
  await writeJson(REPORT_FILE, report);
  await writeJson(INGEST_FILE, ingestion);
  console.log(JSON.stringify(report.totals, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
