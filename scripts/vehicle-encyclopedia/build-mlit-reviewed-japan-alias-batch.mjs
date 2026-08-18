import { createHash } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { WORKSPACE_ROOT, loadWorkspace, normalizeTerm, readJson, writeJson } from "./lib.mjs";

const MLIT_REPORT = path.join(WORKSPACE_ROOT, "reports/model-mlit-japan-2015-2026.json");
const REPORT_FILE = path.join(WORKSPACE_ROOT, "reports/model-mlit-reviewed-japan-aliases.json");
const INGEST_FILE = path.join(WORKSPACE_ROOT, "ingest/models-mlit-reviewed-japan-aliases-2026-08-17.json");

const REVIEWED_IDENTITIES = [
  { modelId: "toyota/86", names: ["86 *2"] },
  { modelId: "toyota/c-hr", names: ["C-HR"] },
  { modelId: "toyota/fj-cruiser", names: ["FJクルーザー"] },
  { modelId: "toyota/gr86", names: ["GR86"] },
  { modelId: "toyota/gr-yaris", names: ["GR ヤリス"] },
  { modelId: "toyota/iq", names: ["iQ"] },
  { modelId: "toyota/rav4", names: ["RAV4"] },
  { modelId: "toyota/sai", names: ["SAI"] },
  { modelId: "toyota/aqua", names: ["アクア"] },
  { modelId: "toyota/auris", names: ["オーリス"] },
  { modelId: "toyota/camry", names: ["カムリ"] },
  { modelId: "toyota/corolla", names: ["カローラ"] },
  { modelId: "toyota/corolla-cross", names: ["カローラクロス"] },
  { modelId: "toyota/corolla-sport", names: ["カローラ スポーツ"] },
  { modelId: "toyota/corolla-touring", names: ["カローラ ツーリング"] },
  { modelId: "toyota/sienta", names: ["シエンタ"] },
  { modelId: "toyota/supra", names: ["スープラ"] },
  { modelId: "toyota/prius", names: ["プリウス"] },
  { modelId: "toyota/yaris", names: ["ヤリス"] },
  { modelId: "toyota/yaris-cross", names: ["ヤリス クロス"] },
  { modelId: "toyota/rush", names: ["ラッシュ *"] },
  { modelId: "toyota/land-cruiser", names: ["ランドクルーザー"] },
  { modelId: "toyota/land-cruiser-prado", names: ["ランドクルーザー プラド"] },
  { modelId: "toyota/jpn-taxi", canonicalName: "JPN TAXI", names: ["JPN TAXI"] },

  { modelId: "honda/accord", names: ["ACCORD", "アコード", "アコード ハイブリッド"] },
  { modelId: "honda/cr-v", canonicalName: "CR-V", names: ["CR-V"] },
  { modelId: "honda/cr-z", names: ["CR-Z"] },
  { modelId: "honda/freed", names: ["FREED", "FREED+", "フリード", "フリード スパイク"] },
  { modelId: "honda/grace", names: ["GRACE"] },
  { modelId: "honda/insight", names: ["インサイト"] },
  { modelId: "honda/jade", names: ["JADE"] },
  { modelId: "honda/legend", names: ["LEGEND"] },
  { modelId: "honda/n-box", names: ["N BOX", "N-BOX", "N-BOX +"], removeNames: ["N BOX Custom", "N-BOX + Custom", "N-BOX CUSTOM", "N-BOX Custom", "N-BOX JOY", "N-BOX SLASH"] },
  { modelId: "honda/n-one", names: ["N-ONE"] },
  { modelId: "honda/n-wgn", names: ["N-WGN"], removeNames: ["N-WGN CUSTOM", "N-WGN Custom"] },
  { modelId: "honda/odyssey", names: ["ODYSSEY", "オデッセイ"] },
  { modelId: "honda/prelude", names: ["PRELUDE"] },
  { modelId: "honda/s660", names: ["S660"] },
  { modelId: "honda/shuttle", names: ["SHUTTLE"] },
  { modelId: "honda/vezel", names: ["VEZEL"] },
  { modelId: "honda/wr-v", names: ["WR-V"] },
  { modelId: "honda/zr-v", names: ["ZR-V"] },
  { modelId: "honda/civic", names: ["シビック"] },
  { modelId: "honda/fit", names: ["フィット"] },
  { modelId: "honda/vamos", canonicalName: "VAMOS", names: ["VAMOS"] },
  { modelId: "honda/vamos-hobio", canonicalName: "VAMOS Hobio", names: ["VAMOS Hobio"] },

  { modelId: "nissan/gt-r", names: ["GT-R"] },
  { modelId: "nissan/x-trail", names: ["エクストレイル"] },
  { modelId: "nissan/kicks", names: ["キックス"] },
  { modelId: "nissan/juke", names: ["ジューク"] },
  { modelId: "nissan/note", names: ["ノート"] },
  { modelId: "nissan/z", names: ["フェアレディZ"] },
  { modelId: "nissan/dayz", canonicalName: "DAYZ", names: ["DAYZ", "デイズ"] },
  { modelId: "nissan/nv200", canonicalName: "NV200", names: ["NV200", "NV200 バネット"] },
  { modelId: "nissan/roox", canonicalName: "ROOX", names: ["ROOX"] },

  { modelId: "suzuki/sx4", names: ["SX4"] },
  { modelId: "suzuki/ignis", names: ["イグニス"] },
  { modelId: "suzuki/vitara", names: ["エスクード"] },
  { modelId: "suzuki/jimny", names: ["ジムニー"] },
  { modelId: "suzuki/swift", names: ["スイフト"] },
  { modelId: "suzuki/baleno", names: ["バレーノ"] },

  { modelId: "mazda/cx-3", names: ["CX-3", "MAZDA CX-3"] },
  { modelId: "mazda/cx-30", names: ["CX-30", "MAZDA CX-30"] },
  { modelId: "mazda/cx-5", names: ["CX-5", "MAZDA CX-5"] },
  { modelId: "mazda/cx-60", names: ["CX-60", "MAZDA CX-60"] },
  { modelId: "mazda/cx-8", names: ["CX-8"] },
  { modelId: "mazda/cx-80", names: ["MAZDA CX-80"] },
  { modelId: "mazda/mazda2", names: ["MAZDA 2", "デミオ"] },
  { modelId: "mazda/mazda3", names: ["MAZDA 3", "アクセラ"] },
  { modelId: "mazda/mazda6", names: ["MAZDA 6", "アテンザ"] },
  { modelId: "mazda/mpv", names: ["MPV"] },
  { modelId: "mazda/mx-30", names: ["MX-30", "MAZDA MX-30"] },
  { modelId: "mazda/mx-5", names: ["MAZDA ROADSTER", "ロードスター"] },

  { modelId: "subaru/brz", names: ["BRZ"] },
  { modelId: "subaru/wrx", names: ["WRX"] },
  { modelId: "subaru/xv", names: ["XV"] },
  { modelId: "subaru/impreza", names: ["インプレッサ"] },
  { modelId: "subaru/crosstrek", names: ["クロストレック"] },
  { modelId: "subaru/justy", names: ["ジャスティ"] },
  { modelId: "subaru/forester", names: ["フォレスター"] },
  { modelId: "subaru/legacy", names: ["レガシィ"] },
  { modelId: "subaru/levorg", names: ["レヴォーグ"] },

  { modelId: "mitsubishi/delica-mini", names: ["DELICA MINI"] },
  { modelId: "mitsubishi/rvr", names: ["RVR"] },
  { modelId: "mitsubishi/outlander", names: ["アウトランダー"] },
  { modelId: "mitsubishi/eclipse-cross", names: ["エクリプス クロス"] },
  { modelId: "mitsubishi/galant", names: ["ギャラン"] },
  { modelId: "mitsubishi/mirage", names: ["ミラージュ"] },
  { modelId: "mitsubishi/lancer", names: [], removeNames: ["ランサーエボ", "ランサーエボリューション"] },
  { modelId: "mitsubishi/ek", canonicalName: "eK", names: ["eK"] },
  { modelId: "mitsubishi/ek-space", canonicalName: "eK SPACE", names: ["eK SPACE"] },

  { modelId: "daihatsu/tanto", names: ["タント"] }
];

function sourceId(url) {
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

function language(value) {
  return /^[\x00-\x7F]+$/.test(value) ? "en" : "ja";
}

export async function buildMlitReviewedJapanAliasBatch({ verifiedAt = "2026-08-17" } = {}) {
  const [workspace, mlit] = await Promise.all([loadWorkspace(), readJson(MLIT_REPORT)]);
  const modelById = new Map(workspace.records.model.map((model) => [model.id, model]));
  const existingSourceIds = new Set(workspace.records.source.map((source) => source.id));
  const updatedModels = [];
  const sources = new Map();
  const accepted = [];

  for (const reviewed of REVIEWED_IDENTITIES) {
    const existing = modelById.get(reviewed.modelId);
    if (!existing && !reviewed.canonicalName) throw new Error(`Missing reviewed MLIT target ${reviewed.modelId}`);
    const brandId = reviewed.modelId.split("/")[0];
    const rows = mlit.candidates.filter((candidate) => candidate.brandId === brandId && candidate.sourceNames.some((name) => reviewed.names.includes(name)));
    const found = new Set(rows.flatMap((candidate) => candidate.sourceNames.filter((name) => reviewed.names.includes(name))));
    const missing = reviewed.names.filter((name) => !found.has(name));
    if (missing.length) throw new Error(`No MLIT source identity for ${reviewed.modelId}: ${missing.join(", ")}`);

    const removedNames = new Set((reviewed.removeNames || []).map(normalizeTerm));
    const sourceNames = [...(existing?.sourceNames || [])].filter((sourceName) => !removedNames.has(normalizeTerm(sourceName.value)));
    const seen = new Set(sourceNames.map((sourceName) => normalizeTerm(sourceName.value)));
    for (const sourceName of reviewed.names) {
      const matchedRows = rows.filter((candidate) => candidate.sourceNames.includes(sourceName));
      const workbookUrls = [...new Set(matchedRows.flatMap((candidate) => candidate.workbookUrls || []))].sort();
      const sourceIds = workbookUrls.map(sourceId);
      for (const url of workbookUrls) {
        const id = sourceId(url);
        if (existingSourceIds.has(id) || sources.has(id)) continue;
        sources.set(id, {
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
      if (!seen.has(normalizeTerm(sourceName))) {
        seen.add(normalizeTerm(sourceName));
        sourceNames.push({ value: sourceName, kind: "source_spelling", safe: true, language: language(sourceName), market: "Japan", sourceIds });
      }
      accepted.push({
        modelId: reviewed.modelId,
        canonicalName: existing?.canonicalName || reviewed.canonicalName,
        sourceName,
        observedInventoryYears: [...new Set(matchedRows.flatMap((candidate) => candidate.observedInventoryYears || []))].sort((left, right) => left - right),
        typeCodes: [...new Set(matchedRows.flatMap((candidate) => candidate.typeCodes || []))].sort(),
        sourceIds
      });
    }

    if (existing) {
      updatedModels.push({ ...existing, sourceNames, updatedAt: verifiedAt });
      continue;
    }
    const sourceIds = [...new Set(sourceNames.flatMap((sourceName) => sourceName.sourceIds || []))].sort();
    updatedModels.push({
      id: reviewed.modelId,
      brandId,
      canonicalName: reviewed.canonicalName,
      slug: reviewed.modelId.split("/")[1],
      aliases: [],
      sourceNames,
      productionFrom: null,
      productionTo: null,
      bodyTypes: [],
      powertrainKinds: [],
      mediaIds: [],
      status: "review",
      evidence: [{
        sourceId: sourceIds[0],
        fields: ["canonicalName"],
        status: "verified",
        confidence: "official",
        note: "Exact Latin-script MLIT common-name identity retained as the canonical English model name; production and generation boundaries remain unverified."
      }],
      researchNotes: ["Demand-led Japan 2015-2026 identity pass; MLIT type codes remain observations and are not promoted to generations or trims."],
      updatedAt: verifiedAt
    });
  }

  updatedModels.sort((left, right) => left.id.localeCompare(right.id, "en", { numeric: true }));
  const report = {
    schemaVersion: 2,
    generatedAt: verifiedAt,
    productionConnected: false,
    policy: {
      exactMlitSourceNamesOnly: true,
      existingEnglishCanonicalRequiredForJapaneseAliases: true,
      newModelsRequireExactLatinScriptMlitIdentity: true,
      combinedMultiModelNamesExcluded: true,
      typeCodesNotPromotedToGenerations: true,
      automaticPublicationReady: false
    },
    totals: {
      reviewedModelIdentities: REVIEWED_IDENTITIES.length,
      updatedModels: updatedModels.length,
      newModels: REVIEWED_IDENTITIES.filter((reviewed) => reviewed.canonicalName).length,
      acceptedSourceNames: accepted.length,
      sourcesAdded: sources.size,
      referencedOfficialSources: new Set(accepted.flatMap((row) => row.sourceIds)).size
    },
    accepted
  };
  const ingestion = { schemaVersion: 2, batches: [...chunk("source", [...sources.values()].sort((left, right) => left.id.localeCompare(right.id, "en"))), ...chunk("model", updatedModels)] };
  return { report, ingestion };
}

async function main() {
  const { report, ingestion } = await buildMlitReviewedJapanAliasBatch();
  await writeJson(REPORT_FILE, report);
  await writeJson(INGEST_FILE, ingestion);
  console.log(JSON.stringify(report.totals, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) await main();
