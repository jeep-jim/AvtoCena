import path from "node:path";
import { pathToFileURL } from "node:url";
import { WORKSPACE_ROOT, loadWorkspace, writeJson } from "./lib.mjs";

const SOURCE_ID = "src-huawei-hicar-current-models-2026";
const REPORT_FILE = path.join(WORKSPACE_ROOT, "reports/huawei-hicar-model-gaps-2026.json");
const INGEST_FILE = path.join(WORKSPACE_ROOT, "ingest/huawei-hicar-model-gaps-2026-08-17.json");

const DEFINITIONS = [
  ["aion", "i60", "埃安 i60"], ["aion", "RT", "埃安 RT"], ["aion", "UT", "埃安 UT"], ["aion", "Y Plus", "埃安 Y Plus"],
  ["aiways", "U6", "爱驰 U6"],
  ["baojun", "RC-5", "宝骏 RC-5"], ["baojun", "RC-5W", "宝骏 RC-5W"], ["baojun", "RC-6", "宝骏 RC-6"],
  ["baojun", "RM-5", "宝骏 RM-5"], ["baojun", "RS-3", "宝骏 RS-3"], ["baojun", "RS-5", "宝骏 RS-5"],
  ["baojun", "RS-7", "宝骏 RS-7"], ["baojun", "Valli", "宝骏 Valli"], ["baojun", "Xiangjing", "宝骏 享境"],
  ["bestune", "B70", "奔腾 B70"], ["bestune", "Yueyi 03", "奔腾 悦意03"], ["bestune", "Yueyi 07", "奔腾 悦意07"], ["bestune", "Yueyi 08", "奔腾 悦意08"],
  ["wuling", "Bingo S", "五菱 缤果S"], ["wuling", "Starlight", "五菱 星光"], ["wuling", "Starlight 560", "五菱 星光560"],
  ["wuling", "Starlight 730", "五菱 星光730"], ["wuling", "Starlight S", "五菱 星光S"],
  ["xpeng", "MONA M03", "小鹏 M03"], ["xpeng", "P7+", "小鹏 P7+"], ["xpeng", "X9", "小鹏 X9"],
  ["exeed", "ET5", "星途 ET5"], ["exeed", "EX7", "星途 EX7"],
  ["im-motors", "L6", "智己 L6"], ["im-motors", "LS6", "智己 LS6"], ["im-motors", "LS7", "智己 LS7"],
  ["im-motors", "LS8", "智己 LS8"], ["im-motors", "LS9", "智己 LS9"],
  ["honda", "P7", "本田 P7"], ["honda", "S7", "本田 S7"],
];

function slug(value) {
  return value.toLowerCase().replace(/\+/g, "-plus").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export async function buildHuaweiHicarModelGapBatch({ updatedAt = "2026-08-17" } = {}) {
  const workspace = await loadWorkspace();
  if (!workspace.records.source.some((source) => source.id === SOURCE_ID)) throw new Error(`${SOURCE_ID} is missing`);
  const existing = new Set(workspace.records.model.map((model) => model.id));
  const models = DEFINITIONS.map(([brandId, canonicalName, localized]) => ({
    id: `${brandId}/${slug(canonicalName)}`,
    brandId,
    canonicalName,
    localized,
  })).filter((model) => !existing.has(model.id)).map((model) => ({
    id: model.id,
    brandId: model.brandId,
    canonicalName: model.canonicalName,
    slug: model.id.split("/").at(-1),
    aliases: [],
    sourceNames: [{
      value: model.localized,
      kind: "localized",
      safe: true,
      language: "zh-CN",
      market: "China",
      sourceIds: [SOURCE_ID],
    }],
    productionFrom: null,
    productionTo: null,
    bodyTypes: [],
    powertrainKinds: [],
    mediaIds: [],
    status: "review",
    evidence: [{
      sourceId: SOURCE_ID,
      fields: ["canonicalName"],
      status: "verified",
      confidence: "high",
      note: "Huawei's official HiCar inventory explicitly lists the model code or public Chinese model name in the 2020-2026 scope. Latin transliterations without an official export spelling remain review-only.",
    }],
    researchNotes: [
      "Priority identity gap only: exact generation, body, powertrain, grade and technical values require manufacturer sources before pricing use.",
      "Compatibility model years are observations and are not copied into productionFrom.",
    ],
    updatedAt,
  })).sort((left, right) => left.id.localeCompare(right.id, "en"));
  const report = {
    schemaVersion: 2,
    generatedAt: updatedAt,
    productionConnected: false,
    totals: { candidateModels: DEFINITIONS.length, newModels: models.length },
    brandIds: [...new Set(models.map((model) => model.brandId))].sort(),
    modelIds: models.map((model) => model.id),
    policy: {
      priority: "Current mass-market China identities observed by an official technology-partner inventory",
      compatibilityYearsNotProductionDates: true,
      bodyAndPowertrainNotInferred: true,
      conservativeLatinCanonicalReviewOnly: true,
      exactChineseSourceNamesRetained: true,
      automaticPublicationReady: false,
    },
  };
  return {
    report,
    ingestion: {
      schemaVersion: 2,
      batches: [{ schemaVersion: 2, entityType: "model", chunk: 1, maxRecords: 250, records: models }],
    },
  };
}

async function main() {
  const { report, ingestion } = await buildHuaweiHicarModelGapBatch();
  await writeJson(REPORT_FILE, report);
  await writeJson(INGEST_FILE, ingestion);
  console.log(JSON.stringify(report.totals, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
