import path from "node:path";
import { pathToFileURL } from "node:url";
import { WORKSPACE_ROOT, loadWorkspace, writeJson } from "./lib.mjs";

const REPORT_FILE = path.join(WORKSPACE_ROOT, "reports/wuling-asta-ice-2021-lineup.json");
const INGEST_FILE = path.join(WORKSPACE_ROOT, "ingest/wuling-asta-ice-2021-lineup-2026-08-17.json");
const MODEL_ID = "wuling/xingchen";
const GENERATION_ID = `${MODEL_ID}/ice-launch-2021`;
const EN_SOURCE_ID = "src-gm-wuling-asta-launch-en-2021";
const ZH_SOURCE_ID = "src-gm-wuling-xingchen-launch-zh-2021";

const VARIANTS = [
  { slug: "1-5t-mt-dynamic", sourceName: "1.5T MT 星动版", name: "1.5T MT Dynamic", transmission: "Manual" },
  { slug: "1-5t-mt-starlight", sourceName: "1.5T MT 星光版", name: "1.5T MT Starlight", transmission: "Manual" },
  { slug: "1-5t-cvt-star-ray", sourceName: "1.5T CVT 星芒版", name: "1.5T CVT Star Ray", transmission: "CVT" },
  { slug: "1-5t-cvt-star-shine", sourceName: "1.5T CVT 星辉版", name: "1.5T CVT Star Shine", transmission: "CVT" },
  { slug: "1-5t-cvt-star-glory", sourceName: "1.5T CVT 星曜版", name: "1.5T CVT Star Glory", transmission: "CVT" },
];

function chunk(entityType, records) {
  return { schemaVersion: 2, entityType, chunk: 1, maxRecords: 250, records };
}

function evidence(sourceId, fields, note) {
  return [{ sourceId, fields, status: "verified", confidence: "official", note }];
}

function alias(value) {
  return { value, kind: "localized", safe: true, language: "zh-CN", market: "China", sourceIds: [ZH_SOURCE_ID] };
}

export async function buildWulingAstaIce2021Batch({ verifiedAt = "2026-08-17" } = {}) {
  const workspace = await loadWorkspace();
  const model = workspace.records.model.find((record) => record.id === MODEL_ID);
  if (!model) throw new Error(`${MODEL_ID} is missing`);
  if (model.canonicalName !== "Asta") throw new Error(`${MODEL_ID} must use the official English canonical name Asta`);

  const sourceIds = new Set(workspace.records.source.map((record) => record.id));
  const generationIds = new Set(workspace.records.generation.map((record) => record.id));
  const variantIds = new Set(workspace.records.variant.map((record) => record.id));

  const sourceDefinitions = [
    {
      id: EN_SOURCE_ID,
      type: "manufacturer",
      title: "Wuling Launches Asta SUV",
      publisher: "General Motors / SAIC-GM-Wuling",
      url: "https://news.gm.com.cn/en/home.detail.html/Pages/news/cn/en/2021/Sept/0917-wuling.html",
      documentId: "GM China Wuling 2021-09-17 EN",
      documentDate: "2021-09-17",
      verifiedAt,
      market: "China",
      language: "en",
      supportedFields: ["canonicalName", "name", "productionFrom", "yearFrom", "market", "bodyType", "bodyTypes", "powertrainKind", "lengthMm", "widthMm", "heightMm", "wheelbaseMm", "seats"],
      confidence: "official",
      status: "active",
      license: null,
      notes: "Official English launch establishes Asta as the public English name and records the SUV launch date, five-variant count, dimensions, wheelbase and five-seat layout.",
    },
    {
      id: ZH_SOURCE_ID,
      type: "manufacturer",
      title: "6.98万-9.98万！首款搭载Ling OS生态SUV五菱星辰“星”动上市",
      publisher: "General Motors / SAIC-GM-Wuling",
      url: "https://news.gm.com.cn/zh/home.detail.html/Pages/news/cn/zh/2021/Sept/0917-wuling.html",
      documentId: "GM China Wuling 2021-09-17 ZH",
      documentDate: "2021-09-17",
      verifiedAt,
      market: "China",
      language: "zh-CN",
      supportedFields: ["name", "yearFrom", "powertrainKind", "transmission"],
      confidence: "official",
      status: "active",
      license: null,
      notes: "Official Chinese launch lists all five exact source-grade names and identifies their MT or CVT transmission families.",
    },
  ];
  const sources = sourceDefinitions.filter((source) => !sourceIds.has(source.id));

  const generations = generationIds.has(GENERATION_ID) ? [] : [{
    id: GENERATION_ID,
    modelId: MODEL_ID,
    name: "ICE launch lineup (2021)",
    aliases: [],
    platformCodes: [],
    productionFrom: "2021-09",
    productionTo: null,
    bodyTypes: ["SUV"],
    status: "review",
    evidence: [
      ...evidence(EN_SOURCE_ID, ["name", "productionFrom", "bodyTypes"], "Official English release records the Asta SUV launch on 2021-09-17."),
    ],
    researchNotes: ["Launch-lineup container only; no unverified platform or internal generation code is inferred."],
    updatedAt: verifiedAt,
  }];

  const variants = VARIANTS
    .filter((definition) => !variantIds.has(`${GENERATION_ID}/${definition.slug}`))
    .map((definition) => ({
      id: `${GENERATION_ID}/${definition.slug}`,
      modelId: MODEL_ID,
      generationId: GENERATION_ID,
      faceliftId: null,
      name: definition.name,
      aliases: [alias(definition.sourceName)],
      market: "China",
      yearFrom: 2021,
      yearTo: null,
      bodyType: "SUV",
      powertrainKind: "ICE",
      transmission: definition.transmission,
      lengthMm: 4594,
      widthMm: 1820,
      heightMm: 1740,
      wheelbaseMm: 2750,
      seats: 5,
      status: "review",
      evidence: [
        ...evidence(EN_SOURCE_ID, ["yearFrom", "market", "bodyType", "powertrainKind", "lengthMm", "widthMm", "heightMm", "wheelbaseMm", "seats"], "Official English launch supplies the China-market identity, shared model dimensions, wheelbase, five-seat layout and 2021 SUV identity."),
        ...evidence(ZH_SOURCE_ID, ["name", "transmission"], "Exact source-grade name and MT/CVT family are transcribed from the official five-grade launch list; the public name is normalized to English and the Chinese label remains searchable."),
      ],
      researchNotes: [
        "The official launch does not publish an exact engine displacement in cm³ or per-grade power values, so those calculation fields remain unset.",
        "MT is normalized to Manual; no gear count is inferred.",
      ],
      updatedAt: verifiedAt,
    }));

  const report = {
    schemaVersion: 2,
    generatedAt: verifiedAt,
    productionConnected: false,
    totals: { newSources: sources.length, newGenerations: generations.length, newVariants: variants.length },
    modelId: MODEL_ID,
    canonicalName: model.canonicalName,
    generationIds: [GENERATION_ID],
    variantIds: variants.map((record) => record.id),
    policy: {
      officialEnglishCanonicalName: true,
      exactOfficialGradeList: true,
      localizedSourceNamesRetainedAsAliases: true,
      noUnverifiedEngineCcOrPower: true,
      noUnverifiedManualGearCount: true,
      automaticPublicationReady: false,
    },
  };

  return {
    report,
    ingestion: {
      schemaVersion: 2,
      batches: [
        ...(sources.length ? [chunk("source", sources)] : []),
        ...(generations.length ? [chunk("generation", generations)] : []),
        ...(variants.length ? [chunk("variant", variants)] : []),
      ],
    },
  };
}

async function main() {
  const { report, ingestion } = await buildWulingAstaIce2021Batch();
  await writeJson(REPORT_FILE, report);
  await writeJson(INGEST_FILE, ingestion);
  console.log(JSON.stringify(report.totals, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
