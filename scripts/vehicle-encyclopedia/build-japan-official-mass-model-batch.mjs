import { createHash } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { WORKSPACE_ROOT, loadWorkspace, readJson, writeJson } from "./lib.mjs";

const MLIT_REPORT = path.join(WORKSPACE_ROOT, "reports/model-mlit-japan-2015-2026.json");
const REPORT_FILE = path.join(WORKSPACE_ROOT, "reports/model-japan-official-mass-market.json");
const INGEST_FILE = path.join(WORKSPACE_ROOT, "ingest/models-japan-official-mass-market-2026-08-17.json");

const REVIEWED_MODELS = [
  { id: "toyota/alphard", canonicalName: "Alphard", sourceName: "アルファード", url: "https://toyota.jp/alphard/", publisher: "Toyota Motor Corporation" },
  { id: "toyota/vellfire", canonicalName: "Vellfire", sourceName: "ヴェルファイア", url: "https://toyota.jp/vellfire/", publisher: "Toyota Motor Corporation" },
  { id: "toyota/roomy", canonicalName: "Roomy", sourceName: "ルーミー", mlitSourceNames: ["ルーミー", "ルーミー *"], url: "https://toyota.jp/roomy/", publisher: "Toyota Motor Corporation" },
  { id: "toyota/noah", canonicalName: "Noah", sourceName: "ノア", url: "https://toyota.jp/noah/", publisher: "Toyota Motor Corporation" },
  { id: "toyota/voxy", canonicalName: "Voxy", sourceName: "ヴォクシー", mlitSourceNames: [], url: "https://toyota.jp/voxy/", publisher: "Toyota Motor Corporation" },
  { id: "toyota/crown", canonicalName: "Crown", sourceName: "クラウン", url: "https://toyota.jp/crown/", publisher: "Toyota Motor Corporation" },
  { id: "toyota/harrier", canonicalName: "Harrier", sourceName: "ハリアー", url: "https://toyota.jp/harrier/", publisher: "Toyota Motor Corporation" },
  { id: "toyota/hiace", canonicalName: "HiAce", sourceName: "ハイエース", url: "https://toyota.jp/hiacevan/", publisher: "Toyota Motor Corporation" },
  { id: "honda/step-wgn", canonicalName: "STEP WGN", sourceName: "ステップワゴン", url: "https://www.honda.co.jp/STEPWGN/", publisher: "Honda Motor Co., Ltd." },
  { id: "nissan/serena", canonicalName: "SERENA", sourceName: "セレナ", url: "https://www3.nissan.co.jp/vehicles/new/serena.html", publisher: "Nissan Motor Co., Ltd." },
  { id: "suzuki/wagon-r", canonicalName: "Wagon R", sourceName: "ワゴンR", url: "https://www.suzuki.co.jp/car/wagonr/", publisher: "Suzuki Motor Corporation" },
  { id: "suzuki/spacia", canonicalName: "Spacia", sourceName: "スペーシア", url: "https://www.suzuki.co.jp/car/spacia/", publisher: "Suzuki Motor Corporation" },
  { id: "suzuki/solio", canonicalName: "Solio", sourceName: "ソリオ", url: "https://www.suzuki.co.jp/car/solio/", publisher: "Suzuki Motor Corporation" },
  { id: "suzuki/hustler", canonicalName: "Hustler", sourceName: "ハスラー", url: "https://www.suzuki.co.jp/car/hustler/", publisher: "Suzuki Motor Corporation" },
  { id: "suzuki/alto", canonicalName: "Alto", sourceName: "アルト", url: "https://www.suzuki.co.jp/car/alto/", publisher: "Suzuki Motor Corporation" },
  { id: "suzuki/fronx", canonicalName: "Fronx", sourceName: "フロンクス", url: "https://www.suzuki.co.jp/car/fronx/", publisher: "Suzuki Motor Corporation" },
  { id: "daihatsu/rocky", canonicalName: "Rocky", sourceName: "ロッキー", url: "https://www.daihatsu.co.jp/lineup/rocky/", publisher: "Daihatsu Motor Co., Ltd." },
  { id: "daihatsu/taft", canonicalName: "Taft", sourceName: "タフト", url: "https://www.daihatsu.co.jp/lineup/taft/", publisher: "Daihatsu Motor Co., Ltd." },
  { id: "daihatsu/mira-e-s", canonicalName: "Mira e:S", sourceName: "ミラ イース", url: "https://www.daihatsu.co.jp/lineup/mira_e-s/", publisher: "Daihatsu Motor Co., Ltd." },
  { id: "daihatsu/move", canonicalName: "Move", sourceName: "ムーヴ", url: "https://www.daihatsu.co.jp/lineup/move/", publisher: "Daihatsu Motor Co., Ltd." }
];

function officialSourceId(modelId) {
  return `src-${modelId.replace("/", "-")}-japan-current-2026`;
}

function mlitSourceId(url) {
  return `src-mlit-passenger-${createHash("sha256").update(url).digest("hex").slice(0, 16)}`;
}

function chunk(entityType, records) {
  return Array.from({ length: Math.ceil(records.length / 250) }, (_, index) => ({
    schemaVersion: 2,
    entityType,
    chunk: index + 1,
    maxRecords: 250,
    records: records.slice(index * 250, (index + 1) * 250)
  }));
}

export async function buildJapanOfficialMassModelBatch({ verifiedAt = "2026-08-17" } = {}) {
  const [workspace, mlit] = await Promise.all([loadWorkspace(), readJson(MLIT_REPORT)]);
  const existingModelIds = new Set(workspace.records.model.map((model) => model.id));
  const existingSourceIds = new Set(workspace.records.source.map((source) => source.id));
  const stagedSourceIds = new Set();
  const sources = [];
  const models = [];
  const reviewed = [];

  for (const definition of REVIEWED_MODELS) {
    if (existingModelIds.has(definition.id)) continue;
    const brandId = definition.id.split("/")[0];
    const officialId = officialSourceId(definition.id);
    if (!existingSourceIds.has(officialId) && !stagedSourceIds.has(officialId)) {
      stagedSourceIds.add(officialId);
      sources.push({
        id: officialId,
        type: "manufacturer",
        title: `${definition.canonicalName} official Japan model page`,
        publisher: definition.publisher,
        url: definition.url,
        documentId: null,
        documentDate: null,
        verifiedAt,
        market: "Japan",
        language: "ja",
        supportedFields: ["canonicalName"],
        confidence: "official",
        status: "active",
        license: null,
        notes: `The official current model page identifies ${definition.canonicalName}; historical generation and production boundaries are not inferred.`
      });
    }

    const mlitNames = definition.mlitSourceNames || [definition.sourceName];
    const candidates = mlit.candidates.filter((candidate) => candidate.brandId === brandId && candidate.sourceNames.some((name) => mlitNames.includes(name)));
    const workbookUrls = [...new Set(candidates.flatMap((candidate) => candidate.workbookUrls || []))].sort();
    const mlitSourceIds = workbookUrls.map(mlitSourceId);
    for (const url of workbookUrls) {
      const id = mlitSourceId(url);
      if (existingSourceIds.has(id) || stagedSourceIds.has(id)) continue;
      stagedSourceIds.add(id);
      sources.push({
        id,
        type: "government_registry",
        title: `Japan passenger-car inventory workbook ${path.basename(new URL(url).pathname)}`,
        publisher: "Ministry of Land, Infrastructure, Transport and Tourism of Japan",
        url,
        documentId: path.basename(new URL(url).pathname),
        documentDate: null,
        verifiedAt,
        market: "Japan",
        language: "ja",
        supportedFields: ["canonicalName"],
        confidence: "official",
        status: "active",
        license: null,
        notes: "Official MLIT passenger-car inventory workbook. Exact Japanese-market common names and type-designation observations are retained without inferring production or generation boundaries."
      });
    }
    const sourceIds = [...new Set([officialId, ...mlitSourceIds])].sort();
    models.push({
      id: definition.id,
      brandId,
      canonicalName: definition.canonicalName,
      slug: definition.id.split("/")[1],
      aliases: [],
      sourceNames: [{ value: definition.sourceName, kind: "localized", safe: true, language: "ja", market: "Japan", sourceIds }],
      productionFrom: null,
      productionTo: null,
      bodyTypes: [],
      powertrainKinds: [],
      mediaIds: [],
      status: "review",
      evidence: [{
        sourceId: officialId,
        fields: ["canonicalName"],
        status: "verified",
        confidence: "official",
        note: "Current official manufacturer model identity; the exact Japanese-market common name is retained as a sourced alias."
      }],
      researchNotes: [
        `MLIT inventory observation years: ${[...new Set(candidates.flatMap((candidate) => candidate.observedInventoryYears || []))].sort((left, right) => left - right).join(", ") || "not yet intersected"}.`,
        "Review status: 2015-2026 generation, facelift, body, engine, grade and canonical-cover coverage remains pending."
      ],
      updatedAt: verifiedAt
    });
    reviewed.push({ id: definition.id, canonicalName: definition.canonicalName, officialSourceId: officialId, mlitCandidateIdentities: candidates.length, mlitSourceIds: mlitSourceIds.length });
  }

  sources.sort((left, right) => left.id.localeCompare(right.id, "en"));
  models.sort((left, right) => left.id.localeCompare(right.id, "en"));
  const report = {
    schemaVersion: 2,
    generatedAt: verifiedAt,
    productionConnected: false,
    policy: {
      officialManufacturerIdentityRequired: true,
      exactJapaneseAliasRequired: true,
      mlitObservationYearsNotProductionYears: true,
      generationsAndTrimsNotInferred: true,
      automaticPublicationReady: false
    },
    totals: {
      reviewedDefinitions: REVIEWED_MODELS.length,
      newModels: models.length,
      officialManufacturerSources: sources.filter((source) => source.type === "manufacturer").length,
      newMlitWorkbookSources: sources.filter((source) => source.type === "government_registry").length,
      totalNewSources: sources.length,
      modelsWithMlitIntersection: reviewed.filter((row) => row.mlitCandidateIdentities > 0).length
    },
    reviewed
  };
  return { report, ingestion: { schemaVersion: 2, batches: [...chunk("source", sources), ...chunk("model", models)] } };
}

async function main() {
  const { report, ingestion } = await buildJapanOfficialMassModelBatch();
  await writeJson(REPORT_FILE, report);
  await writeJson(INGEST_FILE, ingestion);
  console.log(JSON.stringify(report.totals, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
