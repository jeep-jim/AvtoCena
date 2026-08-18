import { createHash } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { WORKSPACE_ROOT, loadWorkspace, normalizeTerm, readJson, writeJson } from "./lib.mjs";

const MLIT_REPORT = path.join(WORKSPACE_ROOT, "reports/model-mlit-japan-2015-2026.json");
const REPORT_FILE = path.join(WORKSPACE_ROOT, "reports/model-japan-official-mass-market-02.json");
const INGEST_FILE = path.join(WORKSPACE_ROOT, "ingest/models-japan-official-mass-market-02-2026-08-17.json");

const REVIEWED_MODELS = [
  { id: "toyota/raize", canonicalName: "Raize", officialSourceName: "ライズ", mlitSourceNames: ["ライズ", "ライズ *"], url: "https://toyota.jp/raize/", publisher: "Toyota Motor Corporation" },
  { id: "nissan/aura", canonicalName: "AURA", officialSourceName: "オーラ", mlitSourceNames: ["ノート オーラ"], url: "https://www3.nissan.co.jp/vehicles/new/aura.html", publisher: "Nissan Motor Co., Ltd." },
  { id: "nissan/elgrand", canonicalName: "ELGRAND", officialSourceName: "エルグランド", mlitSourceNames: ["エルグランド"], url: "https://www3.nissan.co.jp/vehicles/new/elgrand.html", publisher: "Nissan Motor Co., Ltd." },
  { id: "nissan/caravan", canonicalName: "CARAVAN", officialSourceName: "キャラバン", mlitSourceNames: ["NV350 キャラバン", "キャラバン"], url: "https://www3.nissan.co.jp/vehicles/new/caravan.html", publisher: "Nissan Motor Co., Ltd." },
  { id: "suzuki/landy", canonicalName: "Landy", officialSourceName: "ランディ", mlitSourceNames: ["ランディ"], url: "https://www.suzuki.co.jp/car/landy/", publisher: "Suzuki Motor Corporation" },
  { id: "suzuki/wagon-r-smile", canonicalName: "Wagon R Smile", officialSourceName: "ワゴンR スマイル", mlitSourceNames: ["ワゴンR スマイル"], url: "https://www.suzuki.co.jp/car/wagonr_smile/", publisher: "Suzuki Motor Corporation" },
  { id: "suzuki/lapin", canonicalName: "Lapin", officialSourceName: "ラパン", mlitSourceNames: ["アルト ラパン"], url: "https://www.suzuki.co.jp/car/lapin/", publisher: "Suzuki Motor Corporation" },
  { id: "suzuki/xbee", canonicalName: "Xbee", officialSourceName: "クロスビー", mlitSourceNames: ["クロスビー"], url: "https://www.suzuki.co.jp/car/xbee/", publisher: "Suzuki Motor Corporation" },
  { id: "mazda/flair", canonicalName: "FLAIR", mlitSourceNames: ["フレア"], url: "https://www.mazda.co.jp/cars/light-vehicle/flair/", publisher: "Mazda Motor Corporation" },
  { id: "mazda/flair-wagon", canonicalName: "FLAIR WAGON", mlitSourceNames: ["フレア ワゴン"], url: "https://www.mazda.co.jp/cars/light-vehicle/flair-wagon/", publisher: "Mazda Motor Corporation" },
  { id: "mazda/flair-crossover", canonicalName: "FLAIR CROSSOVER", mlitSourceNames: ["フレア クロスオーバー"], url: "https://www.mazda.co.jp/cars/light-vehicle/flair-crossover/", publisher: "Mazda Motor Corporation" },
  { id: "mazda/carol", canonicalName: "CAROL", mlitSourceNames: ["キャロル"], url: "https://www.mazda.co.jp/cars/light-vehicle/carol/", publisher: "Mazda Motor Corporation" },
  { id: "subaru/chiffon", canonicalName: "Chiffon", officialSourceName: "シフォン", mlitSourceNames: ["シフォン"], url: "https://www.subaru.jp/chiffon/", publisher: "Subaru Corporation" },
  { id: "subaru/pleo-plus", canonicalName: "Pleo Plus", officialSourceName: "プレオ プラス", mlitSourceNames: ["プレオ プラス"], url: "https://www.subaru.jp/pleoplus/", publisher: "Subaru Corporation" },
  { id: "subaru/rex", canonicalName: "Rex", officialSourceName: "レックス", mlitSourceNames: ["レックス"], url: "https://www.subaru.jp/rex/", publisher: "Subaru Corporation" },
  { id: "mitsubishi/delica-d5", canonicalName: "Delica D:5", officialSourceName: "デリカD:5", mlitSourceNames: [], url: "https://www.mitsubishi-motors.co.jp/lineup/delica_d5/", publisher: "Mitsubishi Motors Corporation" },
  { id: "mitsubishi/delica-d2", canonicalName: "Delica D:2", officialSourceName: "デリカD:2", mlitSourceNames: ["デリカD:2"], url: "https://www.mitsubishi-motors.co.jp/lineup/delica_d2/", publisher: "Mitsubishi Motors Corporation" },
  { id: "mitsubishi/town-box", canonicalName: "Town Box", officialSourceName: "タウンボックス", mlitSourceNames: ["タウンボックス"], url: "https://www.mitsubishi-motors.co.jp/lineup/townbox/", publisher: "Mitsubishi Motors Corporation" },
  { id: "daihatsu/move-canbus", canonicalName: "Move Canbus", officialSourceName: "ムーヴ キャンバス", mlitSourceNames: ["ムーヴ キャンバス"], url: "https://www.daihatsu.co.jp/lineup/move_canbus/", publisher: "Daihatsu Motor Co., Ltd." },
  { id: "daihatsu/thor", canonicalName: "Thor", officialSourceName: "トール", mlitSourceNames: ["トール"], url: "https://www.daihatsu.co.jp/lineup/thor/", publisher: "Daihatsu Motor Co., Ltd." }
];

function officialSourceId(definition) {
  if (definition.officialSourceId) return definition.officialSourceId;
  const sourceScope = definition.sourceScope === "archive" ? "archive" : "current";
  return `src-${definition.id.replace("/", "-")}-japan-${sourceScope}-2026`;
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

function addSourceName(sourceNames, value, sourceIds) {
  const existing = sourceNames.find((sourceName) => normalizeTerm(sourceName.value) === normalizeTerm(value));
  if (existing) {
    existing.sourceIds = [...new Set([...(existing.sourceIds || []), ...sourceIds])].sort();
    return;
  }
  sourceNames.push({ value, kind: "localized", safe: true, language: "ja", market: "Japan", sourceIds: [...new Set(sourceIds)].sort() });
}

function officialAliases(definition, sourceId) {
  return (definition.aliases || []).map((alias) => {
    const value = typeof alias === "string" ? alias : alias.value;
    return {
      value,
      kind: typeof alias === "string" ? "transliteration" : (alias.kind || "transliteration"),
      safe: typeof alias === "string" ? true : (alias.safe ?? true),
      language: typeof alias === "string" ? "en" : (alias.language ?? "en"),
      market: typeof alias === "string" ? "Japan" : (alias.market ?? "Japan"),
      sourceIds: [sourceId]
    };
  });
}

export async function buildJapanOfficialMassModelBatchFromDefinitions(definitions, { verifiedAt = "2026-08-17" } = {}) {
  const [workspace, mlit] = await Promise.all([loadWorkspace(), readJson(MLIT_REPORT)]);
  const existingModelIds = new Set(workspace.records.model.map((model) => model.id));
  const existingSourceIds = new Set(workspace.records.source.map((source) => source.id));
  const stagedSourceIds = new Set();
  const sources = [];
  const models = [];
  const reviewed = [];

  for (const definition of definitions) {
    if (existingModelIds.has(definition.id)) continue;
    const brandId = definition.id.split("/")[0];
    const mlitBrandId = definition.mlitBrandId || brandId;
    const officialId = officialSourceId(definition);
    const supportedFields = definition.supportedFields || ["canonicalName"];
    if (!existingSourceIds.has(officialId) && !stagedSourceIds.has(officialId)) {
      stagedSourceIds.add(officialId);
      sources.push({
        id: officialId,
        type: definition.sourceType || "manufacturer",
        title: definition.sourceTitle || `${definition.canonicalName} official Japan model page`,
        publisher: definition.publisher,
        url: definition.url,
        documentId: null,
        documentDate: null,
        verifiedAt,
        market: definition.sourceMarket || "Japan",
        language: definition.language || "ja",
        supportedFields,
        confidence: "official",
        status: "active",
        license: null,
        notes: definition.sourceNotes || `The official manufacturer page identifies ${definition.canonicalName}; generation and production boundaries are not inferred.`
      });
    }

    const sourceNames = [];
    if (definition.officialSourceName) addSourceName(sourceNames, definition.officialSourceName, [officialId]);
    const matchedCandidates = [];
    for (const mlitName of definition.mlitSourceNames) {
      const candidates = mlit.candidates.filter((candidate) => candidate.brandId === mlitBrandId && candidate.sourceNames.includes(mlitName));
      if (!candidates.length) throw new Error(`No MLIT source identity for ${definition.id}: ${mlitName}`);
      matchedCandidates.push(...candidates);
      const workbookUrls = [...new Set(candidates.flatMap((candidate) => candidate.workbookUrls || []))].sort();
      const sourceIds = workbookUrls.map(mlitSourceId);
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
      addSourceName(sourceNames, mlitName, sourceIds);
    }

    const observedYears = [...new Set(matchedCandidates.flatMap((candidate) => candidate.observedInventoryYears || []))].sort((left, right) => left - right);
    models.push({
      id: definition.id,
      brandId,
      canonicalName: definition.canonicalName,
      slug: definition.id.split("/")[1],
      aliases: officialAliases(definition, officialId),
      sourceNames,
      productionFrom: definition.productionFrom ?? null,
      productionTo: definition.productionTo ?? null,
      bodyTypes: definition.bodyTypes || [],
      powertrainKinds: definition.powertrainKinds || [],
      mediaIds: [],
      status: "review",
      evidence: [{
        sourceId: officialId,
        fields: supportedFields,
        status: "verified",
        confidence: "official",
        note: definition.evidenceNote || "Official manufacturer model identity; exact Japanese source spellings are retained separately."
      }],
      researchNotes: [
        `MLIT inventory observation years: ${observedYears.join(", ") || "not yet intersected"}.`,
        "Review status: 2015-2026 generation, facelift, body, engine, grade and canonical-cover coverage remains pending."
      ],
      updatedAt: verifiedAt
    });
    reviewed.push({
      id: definition.id,
      canonicalName: definition.canonicalName,
      officialSourceId: officialId,
      exactSourceNames: sourceNames.map((sourceName) => sourceName.value),
      mlitCandidateIdentities: matchedCandidates.length,
      mlitObservationYears: observedYears
    });
  }

  sources.sort((left, right) => left.id.localeCompare(right.id, "en"));
  models.sort((left, right) => left.id.localeCompare(right.id, "en"));
  const report = {
    schemaVersion: 2,
    generatedAt: verifiedAt,
    productionConnected: false,
    policy: {
      officialManufacturerOrGovernmentIdentityRequired: true,
      exactJapaneseAliasesSeparatedBySource: true,
      mlitObservationYearsNotProductionYears: true,
      generationsAndTrimsNotInferred: true,
      automaticPublicationReady: false
    },
    totals: {
      reviewedDefinitions: definitions.length,
      newModels: models.length,
      officialManufacturerSources: sources.filter((source) => source.type === "manufacturer").length,
      officialGovernmentSources: sources.filter((source) => source.type === "government_registry").length,
      newMlitWorkbookSources: sources.filter((source) => source.type === "government_registry").length,
      totalNewSources: sources.length,
      modelsWithMlitIntersection: reviewed.filter((row) => row.mlitCandidateIdentities > 0).length
    },
    reviewed
  };
  return { report, ingestion: { schemaVersion: 2, batches: [...chunk("source", sources), ...chunk("model", models)] } };
}

export async function buildJapanOfficialMassModelBatch02(options = {}) {
  return buildJapanOfficialMassModelBatchFromDefinitions(REVIEWED_MODELS, options);
}

async function main() {
  const { report, ingestion } = await buildJapanOfficialMassModelBatch02();
  await writeJson(REPORT_FILE, report);
  await writeJson(INGEST_FILE, ingestion);
  console.log(JSON.stringify(report.totals, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
