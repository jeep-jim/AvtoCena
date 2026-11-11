import path from "node:path";
import { pathToFileURL } from "node:url";
import { WORKSPACE_ROOT, writeJson } from "./lib.mjs";
import { buildJapanOfficialMassModelBatchFromDefinitions } from "./build-japan-official-mass-model-batch-02.mjs";

const REPORT_FILE = path.join(WORKSPACE_ROOT, "reports/model-japan-official-mass-market-06.json");
const INGEST_FILE = path.join(WORKSPACE_ROOT, "ingest/models-japan-official-mass-market-06-2026-08-17.json");

const archive = {
  sourceScope: "archive",
  sourceNotes: "The official manufacturer archive identifies this Japan-market model. Only fields stated by the source are staged; end-of-production and generation boundaries are not inferred."
};

const REVIEWED_MODELS = [
  {
    id: "toyota/gr-corolla",
    canonicalName: "GR Corolla",
    mlitSourceNames: ["GRカローラ"],
    url: "https://global.toyota/en/newsroom/toyota/37061854.html",
    publisher: "Toyota Motor Corporation",
    language: "en",
    bodyTypes: ["hatchback"],
    powertrainKinds: ["ICE"],
    supportedFields: ["canonicalName", "bodyTypes", "powertrainKinds"],
    sourceTitle: "TOYOTA GAZOO Racing Premieres GR Corolla"
  },
  {
    ...archive,
    id: "toyota/ist",
    canonicalName: "ist",
    mlitSourceNames: ["イスト"],
    url: "https://global.toyota/en/detail/280774",
    publisher: "Toyota Motor Corporation",
    language: "en",
    productionFrom: "2007-07",
    bodyTypes: ["hatchback"],
    powertrainKinds: ["ICE"],
    supportedFields: ["canonicalName", "productionFrom", "bodyTypes", "powertrainKinds"],
    sourceTitle: "Toyota Launches Fully Redesigned ist"
  },
  {
    ...archive,
    id: "toyota/prius-alpha",
    canonicalName: "Prius α",
    aliases: ["Prius Alpha"],
    mlitSourceNames: ["プリウス α"],
    url: "https://global.toyota/en/newsroom/toyota/22731531.html",
    publisher: "Toyota Motor Corporation",
    language: "en",
    productionFrom: "2011-05",
    powertrainKinds: ["HEV"],
    supportedFields: ["canonicalName", "productionFrom", "powertrainKinds"],
    sourceTitle: "TMC Launches Prius α"
  },
  {
    ...archive,
    id: "toyota/pixis-space",
    canonicalName: "Pixis Space",
    mlitSourceNames: ["ピクシス スペース"],
    url: "https://global.toyota/en/detail/218135",
    publisher: "Toyota Motor Corporation",
    language: "en",
    productionFrom: "2011-09",
    bodyTypes: ["kei-car"],
    powertrainKinds: ["ICE"],
    supportedFields: ["canonicalName", "productionFrom", "bodyTypes", "powertrainKinds"],
    sourceTitle: "TMC Launches Pixis Space Minivehicle in Japan"
  },
  {
    ...archive,
    id: "toyota/ractis",
    canonicalName: "Ractis",
    mlitSourceNames: ["ラクティス"],
    url: "https://global.toyota/en/detail/325494",
    publisher: "Toyota Motor Corporation",
    language: "en",
    productionFrom: "2010-11",
    bodyTypes: ["hatchback"],
    powertrainKinds: ["ICE"],
    supportedFields: ["canonicalName", "productionFrom", "bodyTypes", "powertrainKinds"],
    sourceTitle: "TMC Launches Redesigned Ractis"
  },
  {
    ...archive,
    id: "honda/fit-shuttle",
    canonicalName: "FIT SHUTTLE",
    mlitSourceNames: ["フィット シャトル"],
    url: "https://global.honda/en/pressroom/products/auto/",
    officialSourceId: "src-honda-automobiles-library-2026",
    publisher: "Honda Motor Co., Ltd.",
    language: "en",
    sourceTitle: "Honda Automobiles Library"
  },
  {
    ...archive,
    id: "honda/n-box-slash",
    canonicalName: "N-BOX SLASH",
    aliases: [{ value: "N BOX SLASH", kind: "punctuation" }],
    mlitSourceNames: ["N-BOX SLASH"],
    url: "https://global.honda/en/pressroom/products/auto/",
    officialSourceId: "src-honda-automobiles-library-2026",
    publisher: "Honda Motor Co., Ltd.",
    language: "en",
    sourceTitle: "Honda Automobiles Library"
  },
  {
    ...archive,
    id: "subaru/exiga",
    canonicalName: "Exiga",
    mlitSourceNames: ["エクシーガ"],
    url: "https://www.subaru.jp/dealerservice/ownersmanual/exiga/",
    publisher: "Subaru Corporation",
    language: "ja",
    sourceTitle: "Subaru EXIGA Owner Manuals"
  },
  {
    ...archive,
    id: "subaru/trezia",
    canonicalName: "Trezia",
    mlitSourceNames: ["トレジア*"],
    url: "https://www.subaru.co.jp/news/archives/10_10_12/10_11_29.html",
    publisher: "Subaru Corporation",
    language: "ja",
    productionFrom: "2010-11",
    bodyTypes: ["wagon"],
    supportedFields: ["canonicalName", "productionFrom", "bodyTypes"],
    sourceTitle: "Subaru launches new compact car Trezia"
  }
];

export async function buildJapanOfficialMassModelBatch06(options = {}) {
  return buildJapanOfficialMassModelBatchFromDefinitions(REVIEWED_MODELS, options);
}

async function main() {
  const { report, ingestion } = await buildJapanOfficialMassModelBatch06();
  await writeJson(REPORT_FILE, report);
  await writeJson(INGEST_FILE, ingestion);
  console.log(JSON.stringify(report.totals, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
