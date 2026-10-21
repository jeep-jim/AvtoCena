import path from "node:path";
import { pathToFileURL } from "node:url";
import { WORKSPACE_ROOT, writeJson } from "./lib.mjs";
import { buildJapanOfficialMassModelBatchFromDefinitions } from "./build-japan-official-mass-model-batch-02.mjs";

const REPORT_FILE = path.join(WORKSPACE_ROOT, "reports/model-japan-official-mass-market-07.json");
const INGEST_FILE = path.join(WORKSPACE_ROOT, "ingest/models-japan-official-mass-market-07-2026-08-17.json");

const archive = {
  sourceScope: "archive",
  sourceNotes: "The official manufacturer archive identifies this model in the Japan priority window. Only explicitly stated fields are staged; generation and end-of-production boundaries are not inferred."
};

const REVIEWED_MODELS = [
  {
    ...archive,
    id: "toyota/crown-sedan",
    canonicalName: "Crown Sedan",
    mlitSourceNames: ["クラウンセダン"],
    url: "https://global.toyota/en/detail/7911245",
    publisher: "Toyota Motor Corporation",
    language: "en",
    bodyTypes: ["sedan"],
    powertrainKinds: ["ICE"],
    supportedFields: ["canonicalName", "bodyTypes", "powertrainKinds"],
    sourceTitle: "Toyota Crown Sedan enhances Japan luxury lineup"
  },
  {
    ...archive,
    id: "toyota/comfort",
    canonicalName: "Comfort",
    mlitSourceNames: ["コンフォート"],
    url: "https://global.toyota/en/detail/7912522",
    publisher: "Toyota Motor Corporation",
    language: "en",
    productionFrom: "1995-12",
    bodyTypes: ["sedan"],
    powertrainKinds: ["ICE"],
    supportedFields: ["canonicalName", "productionFrom", "bodyTypes", "powertrainKinds"],
    sourceTitle: "Toyota introduces Crown Comfort and Comfort for taxi use"
  },
  {
    ...archive,
    id: "mazda/az-offroad",
    canonicalName: "AZ-Offroad",
    aliases: [{ value: "AZ-OFFROAD", kind: "punctuation" }],
    mlitSourceNames: ["AZ-オフロード"],
    url: "https://newsroom.mazda.com/en/publicity/release/1998/9810/981013_04e.html",
    publisher: "Mazda Motor Corporation",
    language: "en",
    productionFrom: "1998-10",
    bodyTypes: ["suv"],
    powertrainKinds: ["ICE"],
    supportedFields: ["canonicalName", "productionFrom", "bodyTypes", "powertrainKinds"],
    sourceTitle: "Mazda Introduces New AZ-Offroad"
  },
  {
    ...archive,
    id: "subaru/pleo",
    canonicalName: "Pleo",
    mlitSourceNames: ["プレオ"],
    url: "https://www.subaru.jp/dealerservice/idlingstop/",
    officialSourceId: "src-subaru-idling-stop-model-list-2026",
    publisher: "Subaru Corporation",
    language: "ja",
    sourceTitle: "Subaru idling-stop model list"
  },
  {
    ...archive,
    id: "subaru/dias-wagon",
    canonicalName: "Dias Wagon",
    aliases: ["Dias"],
    mlitSourceNames: ["ディアス"],
    url: "https://www.subaru.jp/dealerservice/idlingstop/",
    officialSourceId: "src-subaru-idling-stop-model-list-2026",
    publisher: "Subaru Corporation",
    language: "ja",
    sourceTitle: "Subaru idling-stop model list"
  },
  {
    ...archive,
    id: "daihatsu/atrai-wagon",
    canonicalName: "Atrai Wagon",
    mlitSourceNames: ["アトレーワゴン"],
    url: "https://www.daihatsu.com/news/2017/20171113-2.html",
    publisher: "Daihatsu Motor Co., Ltd.",
    language: "en",
    bodyTypes: ["kei-car"],
    powertrainKinds: ["ICE"],
    supportedFields: ["canonicalName", "bodyTypes", "powertrainKinds"],
    sourceTitle: "Daihatsu partial redesign of Atrai Wagon"
  },
  {
    ...archive,
    id: "daihatsu/altis",
    canonicalName: "Altis",
    mlitSourceNames: ["アルティス"],
    url: "https://www.daihatsu.com/news/2015/20151006-4.html",
    publisher: "Daihatsu Motor Co., Ltd.",
    language: "en",
    bodyTypes: ["sedan"],
    powertrainKinds: ["HEV"],
    supportedFields: ["canonicalName", "bodyTypes", "powertrainKinds"],
    sourceTitle: "Daihatsu Altis undergoes minor changes"
  },
  {
    ...archive,
    id: "daihatsu/be-go",
    canonicalName: "Be-go",
    aliases: [{ value: "Bego", kind: "punctuation" }],
    mlitSourceNames: ["ビーゴ"],
    url: "https://www.daihatsu.com/news/2006/06011701.html",
    publisher: "Daihatsu Motor Co., Ltd.",
    language: "en",
    productionFrom: "2006-01",
    bodyTypes: ["suv"],
    powertrainKinds: ["ICE"],
    supportedFields: ["canonicalName", "productionFrom", "bodyTypes", "powertrainKinds"],
    sourceTitle: "Daihatsu and Toyota launch new compact SUV"
  },
  {
    ...archive,
    id: "daihatsu/mira",
    canonicalName: "Mira",
    mlitSourceNames: ["ミラ"],
    url: "https://www.daihatsu.com/news/2009/09100701.html",
    publisher: "Daihatsu Motor Co., Ltd.",
    language: "en",
    sourceTitle: "Daihatsu production vehicles at the 39th Tokyo Motor Show"
  },
  {
    ...archive,
    id: "daihatsu/mira-cocoa",
    canonicalName: "Mira Cocoa",
    mlitSourceNames: ["ミラ ココア"],
    url: "https://www.daihatsu.com/news/2015/20150408-2.html",
    officialSourceId: "src-daihatsu-mira-cocoa-move-conte-2015",
    publisher: "Daihatsu Motor Co., Ltd.",
    language: "en",
    bodyTypes: ["kei-car"],
    powertrainKinds: ["ICE"],
    supportedFields: ["canonicalName", "bodyTypes", "powertrainKinds"],
    sourceTitle: "Daihatsu Mira Cocoa and Move Conte special models"
  },
  {
    ...archive,
    id: "daihatsu/move-conte",
    canonicalName: "Move Conte",
    mlitSourceNames: ["ムーヴ コンテ"],
    url: "https://www.daihatsu.com/news/2015/20150408-2.html",
    officialSourceId: "src-daihatsu-mira-cocoa-move-conte-2015",
    publisher: "Daihatsu Motor Co., Ltd.",
    language: "en",
    bodyTypes: ["kei-car"],
    powertrainKinds: ["ICE"],
    supportedFields: ["canonicalName", "bodyTypes", "powertrainKinds"],
    sourceTitle: "Daihatsu Mira Cocoa and Move Conte special models"
  },
  {
    ...archive,
    id: "daihatsu/mebius",
    canonicalName: "Mebius",
    aliases: [{ value: "MEBIUS", kind: "punctuation" }],
    mlitSourceNames: ["メビウス"],
    url: "https://www.daihatsu.com/news/2013/",
    publisher: "Daihatsu Motor Co., Ltd.",
    language: "en",
    powertrainKinds: ["HEV"],
    supportedFields: ["canonicalName", "powertrainKinds"],
    sourceTitle: "Daihatsu launches a new hybrid vehicle: MEBIUS"
  }
];

export async function buildJapanOfficialMassModelBatch07(options = {}) {
  return buildJapanOfficialMassModelBatchFromDefinitions(REVIEWED_MODELS, options);
}

async function main() {
  const { report, ingestion } = await buildJapanOfficialMassModelBatch07();
  await writeJson(REPORT_FILE, report);
  await writeJson(INGEST_FILE, ingestion);
  console.log(JSON.stringify(report.totals, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
